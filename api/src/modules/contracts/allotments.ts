import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import { countProblem, dateProblem } from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   ALLOTMENTS - rooms held for a company or an agent (D27-383 item 8,
   built under D27-396; migration 267)

   A block of rooms of one type held under one of the company's contracts,
   for nights inside it, at that contract's rate. N days before each night
   the rooms nobody booked go back on sale at the night audit
   (app.release_allotments, night-audit/nightAudit.ts), and the release is
   recorded. Picking up is a booking made against it (reservations/book.ts,
   through `allotmentPickup` below).

     who     kept by the owner, an administrator or the GM, as contracts are
             (C-6; 267's policies hold it too); read by whoever reads
             companies or bookings; picked up by whoever may book
     never   an allotment never overbooks the hotel: it holds no more than is
             free on every night, under one lock per hotel, which pickups
             take too

   Every refusal is asked before the first write (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const allotments = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** "13 Nov 2026" (QA X-4: no ISO dates in a sentence). */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One lock per hotel for everything that holds or takes an allotment's
    rooms: two managers, or a manager and a pickup, cannot both see the
    same free room. Held to the end of the transaction. */
export async function lockAllotments(client: Client, hotelId: string) {
  await client.query("select pg_advisory_xact_lock(hashtext('allotments:' || $1::text))", [hotelId]);
}

/* ── Reading ──────────────────────────────────────────────────────── */

export interface AllotmentNight {
  night: string; picked: number; held: number; released: boolean;
  /** Recorded at the release: rooms back on sale, and the day whose audit did it. */
  releasedRooms: number | null; releasedOn: string | null;
}

export interface Allotment {
  id: string; contractId: string; contractName: string;
  companyId: string; companyName: string; companyKind: string;
  roomTypeId: string; roomType: string;
  firstNight: string; lastNight: string; rooms: number; releaseDays: number;
  notes: string | null;
  /** The contract's figures for this room type, plan by plan; empty for a
      discount contract (discountPercent) or where none is agreed - a dash. */
  rates: { mealPlan: string; single: number | null; double: number | null }[];
  discountPercent: number | null;
  nights: AllotmentNight[];
}

/** Active allotments at this hotel, by `where` (a clause on `a`). */
export async function readAllotments(
  client: Client, hotelId: string, where: string, params: unknown[],
): Promise<Allotment[]> {
  const { rows } = await client.query<Allotment>(
    `select a.id::text, a.contract_id::text as "contractId", k.name as "contractName",
            co.id::text as "companyId", co.name as "companyName", co.kind as "companyKind",
            a.room_type_id::text as "roomTypeId", rt.name as "roomType",
            a.first_night::text as "firstNight", a.last_night::text as "lastNight",
            a.rooms, a.release_days as "releaseDays", a.notes,
            k.discount_percent::float8 as "discountPercent",
            coalesce((select json_agg(json_build_object(
                       'mealPlan', r.meal_plan, 'single', r.price_single::float8,
                       'double', r.price_double::float8) order by r.meal_plan)
                        from contract_rates r
                       where r.contract_id = k.id and r.room_type_id = a.room_type_id), '[]') as rates,
            coalesce((select json_agg(json_build_object(
                       'night', h.night, 'picked', h.picked, 'held', h.held, 'released', h.released,
                       'releasedRooms', rel.rooms, 'releasedOn', rel.business_date) order by h.night)
                        from app.allotment_held($1, a.first_night, a.last_night) h
                        left join allotment_releases rel
                               on rel.allotment_id = h.allotment_id and rel.night = h.night
                       where h.allotment_id = a.id), '[]') as nights
       from allotments a
       join contracts k   on k.id = a.contract_id
       join companies co  on co.id = k.company_id
       join room_types rt on rt.id = a.room_type_id
      where a.hotel_id = $1 and a.is_active and ${where}
      order by a.first_night, rt.sort_order, rt.name`,
    [hotelId, ...params]);
  return rows;
}

allotments.get("/:code/allotments/:id", async (c) => {
  const id = c.req.param("id");
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(id)) return null;
    const [one] = await readAllotments(client, hotelId, "a.id = $2", [id]);
    return one ? { ...one, today: await businessDateFor(client, hotelId) } : null;
  });
  return body ? c.json(body) : c.json({ error: "No such allotment here." }, 404);
});

/* ── Holding: what an allotment may hold, or why not ──────────────── */

interface AllotmentInput {
  contractId?: unknown; roomTypeId?: unknown; firstNight?: unknown; lastNight?: unknown;
  rooms?: unknown; releaseDays?: unknown; notes?: unknown; active?: unknown;
}

type Held = {
  firstNight: string; lastNight: string; rooms: number; releaseDays: number; notes: string | null;
};

/** The allotment as it will be saved, or the sentence refusing it. `was`
    is the allotment being changed: its own held rooms are not counted
    against it, and the nights already released stay released. */
async function holdProblem(
  client: Client, hotelId: string, roomTypeId: string, contractId: string,
  was: { id: string } | null, input: AllotmentInput,
): Promise<Held | { reason: string }> {
  const firstNight = typeof input.firstNight === "string" ? input.firstNight : "";
  const lastNight = typeof input.lastNight === "string" ? input.lastNight : "";
  const badDate = dateProblem(firstNight) ?? dateProblem(lastNight);
  if (badDate) return { reason: `First and last night: ${badDate}` };
  if (lastNight < firstNight) return { reason: "The last night is on or after the first." };
  if (Date.parse(lastNight) - Date.parse(firstNight) > 365 * 86_400_000) {
    return { reason: "An allotment holds a year of nights at most." };
  }
  const rooms = Number(input.rooms);
  const roomsWrong = countProblem(rooms, "Rooms", 1, 500);
  if (roomsWrong) return { reason: roomsWrong };
  const releaseDays = Number(input.releaseDays);
  const releaseWrong = countProblem(releaseDays, "Release days", 0, 365);
  if (releaseWrong) return { reason: releaseWrong };
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
  if (notes && notes.length > 500) return { reason: "Notes are at most 500 characters." };

  const today = await businessDateFor(client, hotelId);
  if (!was && firstNight < today) {
    return { reason: `An allotment starts on the business date, ${day(today)}, or later.` };
  }

  const { rows: k } = await client.query<{ name: string; valid_from: string; valid_to: string }>(
    `select name, valid_from::text, valid_to::text from contracts
      where id = $1 and hotel_id = $2 and is_active`, [contractId, hotelId]);
  if (!k[0]) return { reason: "That contract is not here any more." };
  if (firstNight < k[0].valid_from || lastNight > k[0].valid_to) {
    return { reason: `"${k[0].name}" runs from ${day(k[0].valid_from)} to ${day(k[0].valid_to)}; `
      + "an allotment's nights are inside its contract." };
  }

  /* Night by night: what is free, what this allotment holds now, what has
     been booked from it, and whether the night is already released. */
  const { rows: nights } = await client.query<{
    night: string; type: string; available: number; current: number; picked: number; released: boolean;
  }>(
    `select g.for_date::text as night, g.room_type as type, g.available,
            coalesce(h.held, 0) as current, coalesce(h.picked, 0) as picked,
            coalesce(h.released, false) as released
       from app.inventory_grid($1, $2::date, $3::date) g
       left join app.allotment_held($1, $2::date, $3::date) h
              on h.allotment_id = $5::uuid and h.night = g.for_date
      where g.room_type_id = $4`,
    [hotelId, firstNight, lastNight, roomTypeId, was?.id ?? null]);
  if (nights.length === 0) return { reason: "That room type is not here." };

  if (was) {
    /* A booking made from it, outside the new nights, or more bookings on a
       night than the new count: both would leave a booking off its allotment. */
    const { rows: outside } = await client.query<{ reference: string }>(
      `select reference from reservations
        where allotment_id = $1 and status not in ('cancelled', 'no_show', 'void')
          and (check_in < $2::date or check_out - 1 > $3::date)
        order by check_in limit 1`, [was.id, firstNight, lastNight]);
    if (outside[0]) {
      return { reason: `${outside[0].reference} is booked from this allotment outside those nights. `
        + "Change that booking first, or keep its nights." };
    }
    const crowded = nights.find((n) => n.picked > rooms);
    if (crowded) {
      return { reason: `${crowded.picked} rooms are booked from it on ${day(crowded.night)}; `
        + `it cannot hold fewer than ${crowded.picked}.` };
    }
  }

  /* THE RELEASE MUST STILL BE AHEAD: the first night not yet released goes
     back on sale at the audit closing (night - release days); a date already
     past would release it tonight, before anybody could book from it. */
  const firstHeld = nights.find((n) => !n.released && n.night >= today);
  if (firstHeld && addDays(firstHeld.night, -releaseDays) < today) {
    return { reason: `With ${releaseDays} days' release, the rooms for ${day(firstHeld.night)} `
      + "would go back on sale at tonight's night audit. Choose fewer release days or later nights." };
  }

  /* NEVER AN OVERBOOKING: every night not released, what the allotment will
     hold beyond what it holds now must be free. */
  for (const n of nights) {
    if (n.released || n.night < today) continue;
    const more = Math.max(rooms - n.picked, 0) - n.current;
    if (more > n.available) {
      return { reason: `Only ${n.available} ${n.type} ${n.available === 1 ? "room is" : "rooms are"} `
        + `free on ${day(n.night)}; the allotment would hold ${more} more. An allotment never `
        + "overbooks the hotel." };
    }
  }

  return { firstNight, lastNight, rooms, releaseDays, notes };
}

allotments.post("/:code/allotments", async (c) => {
  const input = await c.req.json<AllotmentInput>().catch(() => ({}) as AllotmentInput);
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const contractId = String(input.contractId ?? "");
    const roomTypeId = String(input.roomTypeId ?? "");
    if (!A_UUID.test(contractId)) return refuse("Under which contract is it held?");
    if (!A_UUID.test(roomTypeId)) return refuse("Which room type is held?");
    await lockAllotments(client, hotelId);
    const held = await holdProblem(client, hotelId, roomTypeId, contractId, null, input);
    if ("reason" in held) return refuse(held.reason);
    const { rows } = await client.query<{ id: string }>(
      `insert into allotments (hotel_id, contract_id, room_type_id, first_night, last_night,
                               rooms, release_days, notes, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id(), app.current_user_id())
       returning id::text`,
      [hotelId, contractId, roomTypeId, held.firstNight, held.lastNight,
       held.rooms, held.releaseDays, held.notes]);
    return { ok: true as const, id: rows[0]!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* Change one - its nights, rooms, release days or notes; never its room
   type or contract (stop it and hold another) - or stop holding it
   (`active: false`): what it holds goes back on sale at once, and the
   bookings made from it stand. */
allotments.put("/:code/allotments/:id", async (c) => {
  const input = await c.req.json<AllotmentInput>().catch(() => ({}) as AllotmentInput);
  const id = c.req.param("id");
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(id)) return null;
    await lockAllotments(client, hotelId);
    const { rows: was } = await client.query<{ contract_id: string; room_type_id: string }>(
      `select contract_id::text, room_type_id::text from allotments
        where id = $1 and hotel_id = $2 and is_active`, [id, hotelId]);
    if (!was[0]) return null;

    if (input.active === false) {
      await client.query(
        "update allotments set is_active = false, updated_by = app.current_user_id() where id = $1", [id]);
      return { ok: true as const, id };
    }
    if ((input.roomTypeId !== undefined && input.roomTypeId !== was[0].room_type_id)
        || (input.contractId !== undefined && input.contractId !== was[0].contract_id)) {
      return refuse("An allotment keeps its room type and contract. Stop it, and hold another.");
    }
    const held = await holdProblem(client, hotelId, was[0].room_type_id, was[0].contract_id, { id }, input);
    if ("reason" in held) return refuse(held.reason);
    await client.query(
      `update allotments set first_night = $2, last_night = $3, rooms = $4, release_days = $5,
              notes = $6, updated_by = app.current_user_id()
        where id = $1`,
      [id, held.firstNight, held.lastNight, held.rooms, held.releaseDays, held.notes]);
    return { ok: true as const, id };
  });
  if (!result) return c.json({ error: "No such allotment here." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Picking up: a booking made against an allotment ───────────────
   Asked by reservations/book.ts, above its first write, for a booking that
   names an allotment. Takes the hotel's allotment lock, so two clerks
   cannot book its last room twice. Answers the company the booking is made
   for (the allotment's, priced by its contract, C-3), or the refusal. */
export async function allotmentPickup(
  client: Client, hotelId: string, allotmentId: string,
  booking: { companyId?: string | undefined; checkIn: string; checkOut: string;
             lines: { roomTypeId?: string | undefined; rooms?: number | undefined }[] },
): Promise<{ companyId: string } | { reason: string }> {
  if (!A_UUID.test(allotmentId)) return { reason: "That allotment is not held any more." };
  await lockAllotments(client, hotelId);
  const [a] = await readAllotments(client, hotelId, "a.id = $2", [allotmentId]);
  if (!a) return { reason: "That allotment is not held any more." };
  if (booking.companyId && booking.companyId !== a.companyId) {
    return { reason: `This allotment is held for ${a.companyName}; book it for them.` };
  }
  if (booking.checkOut <= booking.checkIn) {
    return { reason: "A day use is not taken from an allotment: it holds nights." };
  }
  if (booking.lines.some((l) => l.roomTypeId !== a.roomTypeId)) {
    return { reason: `Only ${a.roomType} rooms are held in this allotment.` };
  }
  const lastNight = addDays(booking.checkOut, -1);
  if (booking.checkIn < a.firstNight || lastNight > a.lastNight) {
    return { reason: `The allotment holds the nights of ${day(a.firstNight)} to ${day(a.lastNight)}; `
      + "this stay runs outside them. Book the other nights as an ordinary booking." };
  }
  const wanted = booking.lines.reduce((n, l) => n + Math.max(1, l.rooms ?? 1), 0);
  for (const n of a.nights.filter((x) => x.night >= booking.checkIn && x.night <= lastNight)) {
    if (n.released) {
      return { reason: `The allotment's rooms for ${day(n.night)} went back on sale`
        + `${n.releasedOn ? ` at the night audit of ${day(n.releasedOn)}` : ""}. `
        + "Book that night as an ordinary booking." };
    }
    if (n.held < wanted) {
      return { reason: `${n.held === 0 ? "No room is" : n.held === 1 ? "Only 1 room is" : `Only ${n.held} rooms are`} `
        + `left in the allotment on ${day(n.night)}.` };
    }
  }
  return { companyId: a.companyId };
}
