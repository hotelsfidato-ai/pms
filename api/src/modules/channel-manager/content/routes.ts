import { Hono } from "hono";
import { withSession } from "../../../auth.ts";
import type { Client } from "../../../db.ts";
import { maySetUpSuAt, SU_REFUSED } from "../access.ts";
import { suConnection } from "../su/runtime.ts";
import { SU_ID, SU_MEAL_PLANS, SU_ROOM_TYPES, isSuMealPlan, isSuRoomType } from "../su/codes.ts";
import {
  loadContent, hotelIdFor, recordHotelSend, recordRoomTypeSend, recordRatePlanSend,
  type HotelContent,
} from "./store.ts";
import { contentProblems, contentRequests } from "./payloads.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 2 OF THE SU CONNECTION — THE HOTEL, ITS ROOM TYPES, ITS RATE PLANS

   GET  /:code/channel-manager/content                 what goes to SU, and what is missing
   PUT  /:code/channel-manager/hotel                   the hotel's SU id and the details SU
                                                       needs that the hotel record lacks
   PUT  /:code/channel-manager/room-types/:roomTypeId  a room type's SU id, SU room type,
                                                       children, and on or off SU
   PUT  /:code/channel-manager/rate-plans/:mealPlan    a meal plan's SU rate plan id, SU
                                                       meal plan, and on or off SU
   POST /:code/channel-manager/content/send            send it all to SU now

   Owner only (access.ts). Saving sends nothing; sending is its own press.

   THE LIVE ACCOUNT. With SU_ENVIRONMENT=live a send goes only for a hotel
   switched on for the channel manager (D17-45) — and the switch is the
   master's, not built yet, so today nothing reaches the live account from
   here at all. The test account takes sends whenever the owner presses.

   AN SU ID DOES NOT CHANGE ONCE SU HAS IT. SU knows the room by that id;
   a new id is a new room on SU and the old one left selling. Taking a room
   type off SU is how it stops, and the id stays with it.
   ══════════════════════════════════════════════════════════════════ */

export const content = new Hono<{ Variables: { subject: string } }>();

type Refusal = { ok: false; reason: string };
const refuse = (reason: string): Refusal => ({ ok: false, reason });

async function hotelForOwner(client: Client, code: string): Promise<string | Refusal | null> {
  const hotelId = await hotelIdFor(client, code);
  if (!hotelId) return null;
  if (!(await maySetUpSuAt(client, hotelId))) return refuse(SU_REFUSED);
  return hotelId;
}

const answer = (c: { json: (b: unknown, s?: number) => Response }, result: unknown) => {
  if (result === null) return c.json({ error: "No such property." }, 404);
  const r = result as { ok?: boolean; reason?: string };
  if (r.ok === false) return c.json(r, r.reason === SU_REFUSED ? 403 : 409);
  return c.json(result);
};

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/* ── Read ─────────────────────────────────────────────────────────── */

content.get("/:code/channel-manager/content", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelForOwner(client, c.req.param("code"));
    if (hotelId === null || typeof hotelId !== "string") return hotelId;
    const loaded = await loadContent(client, hotelId);
    if (!loaded) return null;
    const su = suConnection();
    return {
      ...loaded,
      problems: contentProblems(loaded),
      su: { configured: su.ok, environment: su.ok ? su.settings.environment : null },
      suRoomTypes: SU_ROOM_TYPES.map(([code, name]) => ({ code, name })),
      suMealPlans: SU_MEAL_PLANS.map(([code, name]) => ({ code, name })),
    };
  });
  return answer(c, result);
});

/* ── The hotel's SU details ───────────────────────────────────────── */

content.put("/:code/channel-manager/hotel", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  const suHotelId = text(input["suHotelId"]);
  if (!suHotelId || !SU_ID.test(suHotelId)) {
    return c.json(refuse("The SU hotel id is up to 20 letters, digits and hyphens, with no spaces."), 409);
  }
  const countryCode = text(input["countryCode"])?.toUpperCase() ?? null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    return c.json(refuse("The country is its two-letter code, such as IN."), 409);
  }
  const postalCode = text(input["postalCode"]);
  if (postalCode && postalCode.length > 10) {
    return c.json(refuse("SU takes a postcode of at most 10 characters."), 409);
  }
  const coordinate = (key: string, limit: number, label: string): string | null | Refusal => {
    const raw = input[key];
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > limit) {
      return refuse(`The ${label} is a number between -${limit} and ${limit}.`);
    }
    return n.toFixed(6);
  };
  const latitude = coordinate("latitude", 90, "latitude");
  if (latitude && typeof latitude !== "string") return c.json(latitude, 409);
  const longitude = coordinate("longitude", 180, "longitude");
  if (longitude && typeof longitude !== "string") return c.json(longitude, 409);
  const description = text(input["description"]);
  if (description && description.length > 2000) {
    return c.json(refuse("SU shows at most 2,000 characters of description."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelForOwner(client, c.req.param("code"));
    if (hotelId === null || typeof hotelId !== "string") return hotelId;

    const { rows: current } = await client.query<{ su_hotel_id: string; on_su: boolean }>(
      "select su_hotel_id, on_su from channel_hotels where hotel_id = $1", [hotelId]);
    if (current[0]?.on_su && current[0].su_hotel_id.toUpperCase() !== suHotelId.toUpperCase()) {
      return refuse(
        `SU already has this hotel as ${current[0].su_hotel_id}. Its id cannot change: `
        + "SU would treat a new id as another hotel.");
    }

    const { rows: taken } = await client.query<{ name: string }>(
      `select h.name from channel_hotels ch join hotels h on h.id = ch.hotel_id
        where upper(ch.su_hotel_id) = upper($1) and ch.hotel_id <> $2`,
      [suHotelId, hotelId]);
    if (taken[0]) return refuse(`${taken[0].name} already uses the SU hotel id ${suHotelId}.`);

    await client.query(
      `insert into channel_hotels
         (hotel_id, su_hotel_id, postal_code, country_code, latitude, longitude,
          contact_first_name, contact_last_name, description, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (hotel_id) do update
          set su_hotel_id = excluded.su_hotel_id, postal_code = excluded.postal_code,
              country_code = excluded.country_code, latitude = excluded.latitude,
              longitude = excluded.longitude, contact_first_name = excluded.contact_first_name,
              contact_last_name = excluded.contact_last_name, description = excluded.description,
              updated_by = excluded.updated_by, updated_at = now()`,
      [hotelId, suHotelId, postalCode, countryCode, latitude, longitude,
       text(input["contactFirstName"]), text(input["contactLastName"]), description,
       session.staffId]);
    return { ok: true as const, suHotelId };
  });
  return answer(c, result);
});

/* ── A room type on SU ────────────────────────────────────────────── */

content.put("/:code/channel-manager/room-types/:roomTypeId", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const suRoomId = text(input["suRoomId"]);
  const suRoomType = Number(input["suRoomType"]);
  const maxChildren = Number(input["maxChildren"]);
  const isConnected = input["isConnected"] === true;

  if (!suRoomId || !SU_ID.test(suRoomId)) {
    return c.json(refuse("The SU room id is up to 20 letters, digits and hyphens, with no spaces."), 409);
  }
  if (!Number.isInteger(suRoomType) || !isSuRoomType(suRoomType)) {
    return c.json(refuse("Pick the room type from SU's list."), 409);
  }
  if (!Number.isInteger(maxChildren) || maxChildren < 0) {
    return c.json(refuse("How many children may stay is a whole number, zero or more."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelForOwner(client, c.req.param("code"));
    if (hotelId === null || typeof hotelId !== "string") return hotelId;

    const { rows: types } = await client.query<{ name: string; max_occupancy: number }>(
      "select name, max_occupancy from room_types where id = $1 and hotel_id = $2 and is_active",
      [c.req.param("roomTypeId"), hotelId]);
    const type = types[0];
    if (!type) return refuse("No such room type here.");
    if (maxChildren >= type.max_occupancy) {
      return refuse(
        `${type.name} sleeps ${type.max_occupancy}, so SU needs the number of children `
        + `to be less than ${type.max_occupancy}.`);
    }

    const { rows: current } = await client.query<{ su_room_id: string; on_su: string | null }>(
      "select su_room_id, on_su from channel_room_types where room_type_id = $1",
      [c.req.param("roomTypeId")]);
    if (current[0]?.on_su && current[0].su_room_id.toUpperCase() !== suRoomId.toUpperCase()) {
      return refuse(
        `SU already has ${type.name} as ${current[0].su_room_id}. Its id cannot change: `
        + "SU would treat a new id as another room type. Take it off SU instead.");
    }

    const { rows: taken } = await client.query<{ name: string }>(
      `select rt.name from channel_room_types m join room_types rt on rt.id = m.room_type_id
        where m.hotel_id = $1 and upper(m.su_room_id) = upper($2) and m.room_type_id <> $3`,
      [hotelId, suRoomId, c.req.param("roomTypeId")]);
    if (taken[0]) return refuse(`${taken[0].name} already uses the SU room id ${suRoomId}.`);

    await client.query(
      `insert into channel_room_types
         (room_type_id, hotel_id, su_room_id, su_room_type, max_children, is_connected, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (room_type_id) do update
          set su_room_id = excluded.su_room_id, su_room_type = excluded.su_room_type,
              max_children = excluded.max_children, is_connected = excluded.is_connected,
              updated_by = excluded.updated_by, updated_at = now()`,
      [c.req.param("roomTypeId"), hotelId, suRoomId, suRoomType, maxChildren, isConnected,
       session.staffId]);
    return { ok: true as const, roomType: type.name, isConnected };
  });
  return answer(c, result);
});

/* ── A meal plan as an SU rate plan ───────────────────────────────── */

content.put("/:code/channel-manager/rate-plans/:mealPlan", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const suRatePlanId = text(input["suRatePlanId"]);
  const suMealPlan = Number(input["suMealPlan"]);
  const isConnected = input["isConnected"] === true;

  if (!suRatePlanId || !SU_ID.test(suRatePlanId)) {
    return c.json(refuse("The SU rate plan id is up to 20 letters, digits and hyphens, with no spaces."), 409);
  }
  if (!Number.isInteger(suMealPlan) || !isSuMealPlan(suMealPlan)) {
    return c.json(refuse("Pick the meal plan from SU's list."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelForOwner(client, c.req.param("code"));
    if (hotelId === null || typeof hotelId !== "string") return hotelId;

    const { rows: plans } = await client.query<{ name: string }>(
      "select name from meal_plans where code = $1", [c.req.param("mealPlan")]);
    const plan = plans[0];
    if (!plan) return refuse("No such meal plan.");

    const { rows: current } = await client.query<{ su_rate_plan_id: string; on_su: string | null }>(
      "select su_rate_plan_id, on_su from channel_rate_plans where hotel_id = $1 and meal_plan = $2",
      [hotelId, c.req.param("mealPlan")]);
    if (current[0]?.on_su && current[0].su_rate_plan_id.toUpperCase() !== suRatePlanId.toUpperCase()) {
      return refuse(
        `SU already has ${plan.name} as ${current[0].su_rate_plan_id}. Its id cannot change: `
        + "take it off SU instead.");
    }

    const { rows: taken } = await client.query<{ name: string }>(
      `select mp.name from channel_rate_plans m join meal_plans mp on mp.code = m.meal_plan
        where m.hotel_id = $1 and upper(m.su_rate_plan_id) = upper($2) and m.meal_plan <> $3`,
      [hotelId, suRatePlanId, c.req.param("mealPlan")]);
    if (taken[0]) return refuse(`${taken[0].name} already uses the SU rate plan id ${suRatePlanId}.`);

    await client.query(
      `insert into channel_rate_plans
         (hotel_id, meal_plan, su_rate_plan_id, su_meal_plan, is_connected, updated_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (hotel_id, meal_plan) do update
          set su_rate_plan_id = excluded.su_rate_plan_id, su_meal_plan = excluded.su_meal_plan,
              is_connected = excluded.is_connected, updated_by = excluded.updated_by,
              updated_at = now()`,
      [hotelId, c.req.param("mealPlan"), suRatePlanId, suMealPlan, isConnected, session.staffId]);
    return { ok: true as const, mealPlan: plan.name, isConnected };
  });
  return answer(c, result);
});

/* ── Send ─────────────────────────────────────────────────────────── */

content.post("/:code/channel-manager/content/send", async (c) => {
  const subject = c.get("subject");

  const prepared = await withSession(subject, async (client, session) => {
    const hotelId = await hotelForOwner(client, c.req.param("code"));
    if (hotelId === null || typeof hotelId !== "string") return hotelId;
    const loaded = await loadContent(client, hotelId);
    if (!loaded) return null;
    return { hotelId, staffId: session.staffId, content: loaded };
  });
  if (prepared === null) return c.json({ error: "No such property." }, 404);
  if ("ok" in prepared) return answer(c, prepared);

  const su = suConnection();
  if (!su.ok) return c.json({ ok: false, reason: su.reason, missing: su.missing }, 409);

  const { hotelId, staffId, content: loaded } = prepared as {
    hotelId: string; staffId: string; content: HotelContent;
  };

  if (su.settings.environment === "live" && !loaded.switchedOn) {
    return c.json(refuse(
      "The live SU account is used only for a hotel switched on for the channel manager, "
      + "and this hotel is not switched on. Nothing was sent."), 409);
  }

  const problems = contentProblems(loaded);
  if (problems.length > 0) {
    return c.json({ ok: false, reason: "Nothing was sent. SU needs these first.", problems }, 409);
  }

  const results: Array<{ kind: string; name: string; action: string; ok: boolean; reason: string | null }> = [];
  for (const request of contentRequests(loaded)) {
    const sent = await su.client.post(request.endpoint, request.payload);
    const words = sent.ok ? "SU accepted it." : sent.reason;
    const onSuIfOk = request.action === "deactivated" ? "deactivated" as const : "active" as const;

    await withSession(subject, async (client) => {
      if (request.kind === "hotel") {
        await recordHotelSend(client, hotelId, staffId, sent.ok, words);
      } else if (request.kind === "room type") {
        await recordRoomTypeSend(client, request.roomTypeId!, staffId, request.action, sent.ok, words, onSuIfOk);
      } else {
        await recordRatePlanSend(client, hotelId, request.mealPlan!, staffId, request.action, sent.ok, words, onSuIfOk);
      }
    });

    results.push({ kind: request.kind, name: request.name, action: request.action, ok: sent.ok, reason: sent.ok ? null : sent.reason });

    /* Room types and rate plans hang off the property: if SU refused the
       property, every one after it would be refused for the same reason. */
    if (!sent.ok && request.kind === "hotel") break;
    /* The keys, SU's hourly limit, or no answer: the next call meets the same. */
    if (!sent.ok && sent.kind !== "refused") break;
  }

  const ok = results.every((r) => r.ok);
  return c.json({ ok, environment: su.settings.environment, results }, ok ? 200 : 502);
});
