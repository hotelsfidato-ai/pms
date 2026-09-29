import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { UUID } from "./routes.ts";

/* ══════════════════════════════════════════════════════════════════
   WHICH HOTEL AND ROOM TYPES, IN THE CRS - the owner and an admin (D27-171)

   GET /:code/crs/setup   what is connected, and the lists to pick from
   PUT /:code/crs/setup   the property's CRS id, the source its bookings are
                          filed under, each CRS room type's match here, and
                          whether bookings are read

   The ids are the CRS's document ids (its address bar shows them). A CRS
   room type with no match is not booked by itself; the desk is told why.

   SWITCHED ON, bookings the CRS makes FROM THAT MOMENT are read. One made
   while the bridge was off was typed in by hand, and reading it would book
   it twice.

   The account the reader works as (`run_as`) is not here: it is a service
   account the master sets at go-live, as the channel manager's is.
   ══════════════════════════════════════════════════════════════════ */

export const crsSetup = new Hono<{ Variables: { subject: string } }>();

const SETUP_ROLES = ["owner", "admin"];
export const SETUP_REFUSED =
  "Connecting the CRS is for the owner and an administrator. Ask one of them.";
const CRS_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A group administrator is the owner everywhere. ponytail: another copy of
    the role question (reservations' holdsRoleAt); one helper when the core has it. */
async function maySetUp(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (select 1 from staff s
                     where s.id = app.current_user_id() and s.is_active and s.is_group_admin)
         or exists (select 1 from staff_hotels sh join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = $1
                       and s.is_active and sh.role = any($2::text[])) as may`,
    [hotelId, SETUP_ROLES]);
  return rows[0]?.may === true;
}

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

crsSetup.get("/:code/crs/setup", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUp(client, hotelId))) return { refused: SETUP_REFUSED };

    const { rows: hotel } = await client.query<{
      crs_hotel_id: string; booking_source_id: string; is_on: boolean;
      connected_at: string; reads_as: string | null;
    }>(
      `select ch.crs_hotel_id, ch.booking_source_id::text, ch.is_on, ch.connected_at::text,
              s.full_name as reads_as
         from crs_hotels ch left join staff s on s.id = ch.run_as
        where ch.hotel_id = $1`, [hotelId]);
    const { rows: mapped } = await client.query<{ crs_room_type_id: string; room_type_id: string }>(
      "select crs_room_type_id, room_type_id::text from crs_room_types where hotel_id = $1 order by 1",
      [hotelId]);
    const { rows: types } = await client.query<{ id: string; name: string }>(
      "select id::text, name from room_types where hotel_id = $1 order by name", [hotelId]);
    const { rows: sources } = await client.query<{ id: string; name: string }>(
      "select id::text, name from booking_sources where is_active order by name");

    return {
      crsHotelId: hotel[0]?.crs_hotel_id ?? null,
      bookingSourceId: hotel[0]?.booking_source_id ?? null,
      isOn: hotel[0]?.is_on ?? false,
      connectedAt: hotel[0]?.connected_at ?? null,
      readsAs: hotel[0]?.reads_as ?? null,
      roomTypes: mapped.map((m) => ({ crsRoomTypeId: m.crs_room_type_id, roomTypeId: m.room_type_id })),
      hotelRoomTypes: types,
      sources,
    };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if ("refused" in result) return c.json({ ok: false, reason: result.refused }, 403);
  return c.json(result);
});

interface SetupBody {
  crsHotelId?: unknown;
  bookingSourceId?: unknown;
  isOn?: unknown;
  roomTypes?: Array<{ crsRoomTypeId?: unknown; roomTypeId?: unknown }>;
}

/** Why this setup cannot be saved, in the owner's words; null when it can. */
export function setupProblem(body: SetupBody | null): string | null {
  const crsHotelId = typeof body?.crsHotelId === "string" ? body.crsHotelId.trim() : "";
  const roomTypes = Array.isArray(body?.roomTypes) ? body.roomTypes : [];
  if (!CRS_ID.test(crsHotelId)) return "Type the property's id from the CRS (letters and digits).";
  if (typeof body?.bookingSourceId !== "string" || !UUID.test(body.bookingSourceId)) {
    return "Pick the source CRS bookings are filed under.";
  }
  if (typeof body?.isOn !== "boolean") return "Say whether bookings are read.";
  if (roomTypes.some((r) => typeof r.crsRoomTypeId !== "string" || !CRS_ID.test(r.crsRoomTypeId.trim())
      || typeof r.roomTypeId !== "string" || !UUID.test(r.roomTypeId))) {
    return "Each CRS room type needs its id from the CRS and a room type here.";
  }
  if (new Set(roomTypes.map((r) => String(r.crsRoomTypeId).trim())).size !== roomTypes.length) {
    return "A CRS room type is listed twice.";
  }
  return null;
}

crsSetup.put("/:code/crs/setup", async (c) => {
  const body = await c.req.json().catch(() => null) as SetupBody | null;
  const problem = setupProblem(body);
  if (problem) return c.json({ ok: false, reason: problem }, 400);
  const roomTypes = body!.roomTypes ?? [];

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUp(client, hotelId))) return { ok: false as const, reason: SETUP_REFUSED, status: 403 as const };

    await client.query("savepoint crs_setup");
    try {
      await client.query(
        `insert into crs_hotels (hotel_id, crs_hotel_id, booking_source_id, is_on, updated_by)
         values ($1, $2, $3, $4, $5)
         on conflict (hotel_id) do update
            set crs_hotel_id = excluded.crs_hotel_id,
                booking_source_id = excluded.booking_source_id,
                is_on = excluded.is_on,
                updated_by = excluded.updated_by,
                connected_at = case when excluded.is_on and not crs_hotels.is_on
                                    then now() else crs_hotels.connected_at end,
                read_up_to = case when excluded.is_on and not crs_hotels.is_on
                                  then null else crs_hotels.read_up_to end`,
        [hotelId, String(body!.crsHotelId).trim(), body!.bookingSourceId, body!.isOn, session.staffId]);
      await client.query("delete from crs_room_types where hotel_id = $1", [hotelId]);
      for (const r of roomTypes) {
        await client.query(
          `insert into crs_room_types (hotel_id, crs_room_type_id, room_type_id, updated_by)
           values ($1, $2, $3, $4)`,
          [hotelId, String(r.crsRoomTypeId).trim(), r.roomTypeId, session.staffId]);
      }
    } catch (error) {
      /* 23505: another hotel, which this person may not even be able to
         see, already has that CRS property. 23503: a source or room type
         that is not on this hotel's lists. */
      const code = (error as { code?: string }).code;
      if (code !== "23505" && code !== "23503") throw error;
      await client.query("rollback to savepoint crs_setup");
      return { ok: false as const, status: 409 as const,
        reason: code === "23505"
          ? "That CRS property is already connected to another hotel here."
          : "That source or room type is not on this hotel's list." };
    }
    return { ok: true as const };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if (!result.ok) return c.json({ ok: false, reason: result.reason }, result.status);
  return c.json(result);
});
