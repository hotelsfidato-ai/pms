import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   BK-1 · CANCELLING A CONFIRMED BOOKING (the owner, 28 September)

   A confirmed booking could only be voided; the guest's cancellation and
   its fee could not be recorded. The owner's answers:

     · the terms frozen on the booking decide: inside the free window
       nothing, outside it what the terms keep, on the guest's bill as a
       charge at the room's slab; no terms, no charge
     · the owner, an administrator or the GM may waive it; Reception not
     · this room only - the rest of its group stays booked

   Its own hotel (BKC): check-in at 14:00, rooms taxed 5%, and one written
   policy for new bookings - free until 24 hours before, then first night.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "BKC";
const DESK = "test-uid-bk1-desk";
let hotelId = "";

const cancel = (id: string, body: Record<string, unknown>, who = "dev-owner") =>
  app.request(`/api/hotels/${CODE}/stays/${id}/cancel`, {
    method: "POST",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A confirmed booking arriving `days` from today on the hotel's clock
    (the free window is measured against the real one), at ₹3,000 a night.
    `terms: false` inserts it with the policy switched off, as a booking
    made before the hotel wrote any down. */
async function booking(ref: string, days: number, opts: { terms?: boolean; group?: string } = {}) {
  if (opts.terms === false) {
    await sql("update cancellation_policies set applies_to_new_bookings = false where hotel_id = $1", [hotelId]);
  }
  const [r] = await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status, group_id)
     values ($1, $2, (select id from guests where full_name = 'BK1 guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             (now() at time zone 'Asia/Kolkata')::date + $3::int,
             (now() at time zone 'Asia/Kolkata')::date + $3::int + 2,
             3000, 'confirmed', $4)
     returning id::text`, [hotelId, ref, days, opts.group ?? null]);
  if (opts.terms === false) {
    await sql("update cancellation_policies set applies_to_new_bookings = true where hotel_id = $1", [hotelId]);
  }
  return r!.id;
}

const postings = (id: string) => sql<{ description: string; amount: string; tax_rate: string }>(
  `select p.description, p.amount::text, p.tax_rate::text from folio_postings p
     join folios f on f.id = p.folio_id where f.reservation_id = $1`, [id]);

const state = async (id: string) => (await sql<{ status: string; cancel_reason: string | null }>(
  "select status, cancel_reason from reservations where id = $1", [id]))[0]!;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Cancel Terms Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set timezone = 'Asia/Kolkata', check_in_time = '14:00',
                         business_date = (now() at time zone 'Asia/Kolkata')::date
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,104)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query(
      `insert into cancellation_policies
         (hotel_id, name, free_until_hours, cancel_basis, no_show_basis, applies_to_new_bookings)
       values ($1, 'Free until 24 hours', 24, 'first_night', 'full_stay', true)`, [hotelId]);
    await db.query("insert into guests (full_name) values ('BK1 guest')");
    const desk = (await db.query<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ('bk1-desk@fidato.in', 'BK1 Desk', $1)
       on conflict (email) do update set is_active = true returning id::text`, [DESK])).rows[0]!.id;
    await db.query(
      "insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'front_desk') on conflict do nothing",
      [desk, hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from staff_hotels where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query("delete from reservation_groups where name = 'BK1 family'");
  } finally { await db.end(); }
  await closePool();
});

describe("BK-1 · a confirmed booking the guest cancelled", () => {
  it("inside the free window: says nothing is charged, and charges nothing", async () => {
    const id = await booking("BKC-FREE", 10);
    const preview = await cancel(id, { dryRun: true });
    expect(await preview.json()).toEqual({
      ok: true, preview: { terms: "Free until 24 hours", charge: 0 } });
    expect((await state(id)).status, "a preview writes nothing").toBe("confirmed");

    const res = await cancel(id, { reason: "Guest changed plans" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await state(id)).toEqual({ status: "cancelled", cancel_reason: "Guest changed plans" });
    expect(await postings(id)).toEqual([]);
  });

  it("outside it: the terms' first night goes on the bill, at the room's slab", async () => {
    const id = await booking("BKC-LATE", 0);
    expect(await (await cancel(id, { dryRun: true })).json()).toEqual({
      ok: true, preview: { terms: "Free until 24 hours", charge: 3000 } });

    const res = await cancel(id, { reason: "Flight cancelled" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rooms: 1, charged: 3000, waived: false });
    expect((await state(id)).status).toBe("cancelled");
    expect(await postings(id)).toEqual([{
      description: "Retention - cancellation (Free until 24 hours)", amount: "3000.00", tax_rate: "5.00",
    }]);
  });

  it("a booking made under no terms is cancelled with no charge", async () => {
    const id = await booking("BKC-NOTERMS", 0, { terms: false });
    expect(await (await cancel(id, { dryRun: true })).json()).toEqual({
      ok: true, preview: { terms: null, charge: null } });
    expect((await cancel(id, { reason: "No reason given" })).status).toBe(200);
    expect(await postings(id)).toEqual([]);
  });

  it("Reception may not waive the charge; the owner may, and the reason says so", async () => {
    const id = await booking("BKC-WAIVE", 0);
    const refused = await cancel(id, { reason: "Regular guest", waive: true }, DESK);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toMatch(/waived by the owner/);
    expect((await state(id)).status, "a refusal writes nothing").toBe("confirmed");

    const res = await cancel(id, { reason: "Regular guest", waive: true });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, charged: 0, waived: true });
    expect(await state(id)).toEqual({
      status: "cancelled", cancel_reason: "Regular guest (the ₹3000.00 charge waived)" });
    expect(await postings(id)).toEqual([]);
  });

  it("Reception cancels without waiving", async () => {
    const id = await booking("BKC-DESK", 10);
    const res = await cancel(id, { reason: "Guest changed plans" }, DESK);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("cancels this room only - the rest of its group stays booked", async () => {
    const [g] = await sql<{ id: string }>(
      "insert into reservation_groups (name) values ('BK1 family') returning id::text");
    const one = await booking("BKC-G1", 10, { group: g!.id });
    const two = await booking("BKC-G2", 10, { group: g!.id });
    expect((await cancel(one, { reason: "One room fewer" })).status).toBe(200);
    expect((await state(one)).status).toBe("cancelled");
    expect((await state(two)).status).toBe("confirmed");
  });

  it("asks for a reason, and refuses a booking already cancelled", async () => {
    const id = await booking("BKC-TWICE", 10);
    expect((await cancel(id, {})).status).toBe(409);
    expect((await cancel(id, { reason: "First" })).status).toBe(200);
    const again = await cancel(id, { reason: "Second" });
    expect(((await again.json()) as { reason: string }).reason).toBe("BKC-TWICE is already cancelled.");
  });
});
