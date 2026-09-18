import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closePool, withUser } from "../../../src/db.ts";
import {
  createChannelBooking, cancelChannelBooking, channelBookingAlreadyHere,
} from "../../../src/modules/reservations/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING FROM A BOOKING SITE - reservations' door for a machine

   The owner's D17-79: SU pushes a booking and the channel manager turns it
   into a real one, in process, inside its own transaction. This proves the
   three things that make it different from a booking at the desk:

     · it REFUSES rather than overbooking (D17-43, D17-80), and a refusal
       leaves nothing behind - not the guest, not a folio, not a group;
     · the same push twice is ONE booking (RES-3);
     · it is CANCELLED, not voided, and a booking that has arrived is not
       cancelled at all.

   Every test counts what is in the database afterwards, not only what the
   function answered.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerStaffId: string;
let hotelId: string;
let typeId: string;
let typeName: string;
let agoda: string;

/* Far enough ahead that nothing else in the suite is looking at these nights. */
const IN = "2029-04-10";
const OUT = "2029-04-12";

const session = <T>(fn: Parameters<typeof withUser<T>>[1]) => withUser(ownerStaffId, fn);

const booking = (ref: string, over: Record<string, unknown> = {}) => ({
  hotelId,
  guestName: `CHAN ${ref}`,
  phone: "9800000123",
  checkIn: IN,
  checkOut: OUT,
  bookingSourceId: agoda,
  externalRef: ref,
  commissionAmount: "1234.50",
  specialRequest: "High floor if possible",
  lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, children: 0, rooms: 1, agreedRate: 4200 }],
  ...over,
});

beforeAll(async () => {
  const { rows: staff } = await sql("select id::text from staff where email = 'owner@fidato.in'");
  ownerStaffId = staff[0].id;
  const { rows: hotels } = await sql("select id::text from hotels where code = '5EL'");
  hotelId = hotels[0].id;
  const { rows: types } = await sql(
    `select rt.id::text, rt.name from room_types rt
      where rt.hotel_id = $1 order by rt.sort_order limit 1`, [hotelId]);
  typeId = types[0].id;
  typeName = types[0].name;
  const { rows: sources } = await sql(
    "select id::text from booking_sources where is_active and name = 'Agoda'");
  agoda = sources[0].id;
});

afterAll(async () => {
  const { rows } = await sql(
    `select r.id::text, r.guest_id::text from reservations r
       join guests g on g.id = r.guest_id where g.full_name like 'CHAN %'`);
  const ids = rows.map((r) => r.id);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("alter table guests disable trigger guests_no_delete");
  try {
    await sql("delete from guests where full_name like 'CHAN %'");
  } finally {
    await sql("alter table guests enable trigger guests_no_delete");
  }
  await closePool();
});

const guestCount = async () =>
  Number((await sql("select count(*)::text as n from guests where full_name like 'CHAN %'")).rows[0].n);

describe("a booking a site has taken", () => {
  it("makes it, with the site's reference, its commission and what the guest asked for", async () => {
    const result = await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-1")));

    expect(result.ok, "ok" in result ? JSON.stringify(result) : "").toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.reference).toMatch(/^FH-/);
    expect(result.reservationIds).toHaveLength(1);
    expect(result.folioIds, "a booking needs somewhere to put money").toHaveLength(1);

    const { rows } = await sql(
      `select r.status, r.ota_reference, r.commission_amount::text as commission,
              r.notes, r.agreed_rate::text as rate, bs.name as source,
              (select count(*)::int from folios f where f.reservation_id = r.id) as folios
         from reservations r join booking_sources bs on bs.id = r.booking_source_id
        where r.id = $1`, [result.reservationIds[0]]);
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].ota_reference).toBe("SU-CHAN-1");
    expect(rows[0].commission, "what the site said it keeps (D17-84)").toBe("1234.50");
    expect(rows[0].notes).toContain("High floor");
    expect(rows[0].rate).toBe("4200.00");
    expect(rows[0].source).toBe("Agoda");
    expect(rows[0].folios).toBe(1);
  });

  it("answers the same push sent twice with the booking already here", async () => {
    const first = await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-2")));
    const again = await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-2")));

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate, "the second push made nothing").toBe(true);
    expect(again.references).toEqual(first.references);
    expect(again.reservationIds, "nothing was made this time").toHaveLength(0);

    const { rows } = await sql(
      `select count(*)::int as n from reservations
        where hotel_id = $1 and ota_reference = 'SU-CHAN-2'`, [hotelId]);
    expect(rows[0].n, "one booking, not two").toBe(1);

    /* And after a lost race, where the winner's rows are in another
       transaction, the caller finds the same answer. */
    const found = await session((client) =>
      channelBookingAlreadyHere(client, booking("SU-CHAN-2")));
    expect(found?.ok && found.duplicate).toBe(true);
  });

  it("refuses rather than overbooking, and leaves nothing behind (D17-80)", async () => {
    const { rows: free } = await sql(
      `select coalesce(min(g.available), 0)::int as short
         from app.inventory_grid($1, $2::date, ($3::date - 1)) g
        where g.room_type_id = $4`, [hotelId, IN, OUT, typeId]);
    const tooMany = Math.min(40, free[0].short + 1);

    const before = await guestCount();
    const result = await session((client) =>
      createChannelBooking(client, ownerStaffId,
        booking("SU-CHAN-3", { lines: [{ roomTypeId: typeId, adults: 2, rooms: tooMany, agreedRate: 4200 }] })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("no_room");
    expect(result.reason).toContain(typeName);
    expect(await guestCount(), "a refusal wrote no guest").toBe(before);
    const { rows } = await sql(
      "select count(*)::int as n from reservations where ota_reference = 'SU-CHAN-3'");
    expect(rows[0].n).toBe(0);
  });

  it("will not invent a price: an unpriced line is refused by name, never charged at zero", async () => {
    const result = await session((client) =>
      createChannelBooking(client, ownerStaffId,
        booking("SU-CHAN-4", {
          /* No agreedRate, and forty people in the party: nothing prices that,
             so the rate calendar has no answer. */
          lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 40, rooms: 1 }],
        })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["unpriced", "refused"]).toContain(result.kind);
    expect(result.reason.toLowerCase()).not.toContain("0.00");
  });
});

describe("a booking the site cancelled", () => {
  it("cancels it, says why, and counts as a cancellation rather than a void", async () => {
    const made = await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-5")));
    expect(made.ok).toBe(true);

    const result = await session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-5",
        reason: "The guest cancelled on Agoda.",
        chargeFrom: "channel", channelFee: "500.00",
      }));

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCancelled).toBe(false);

    const { rows } = await sql(
      `select status, cancel_reason, cancelled_at is not null as stamped,
              cancelled_by::text as by
         from reservations where ota_reference = 'SU-CHAN-5'`);
    expect(rows[0].status, "cancelled, not void").toBe("cancelled");
    expect(rows[0].cancel_reason).toContain("cancelled on Agoda");
    expect(rows[0].cancel_reason, "what the site charges is recorded").toContain("500.00");
    expect(rows[0].stamped).toBe(true);
    expect(rows[0].by).toBe(ownerStaffId);
  });

  it("says so when it is cancelled twice, and when there is no such booking", async () => {
    await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-6")));
    const cancel = () => session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-6",
        reason: "Cancelled on the site.", chargeFrom: "channel",
      }));
    expect((await cancel()).ok).toBe(true);
    const second = await cancel();
    expect(second.ok && second.alreadyCancelled).toBe(true);

    const missing = await session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-NOT-HERE",
        reason: "Cancelled on the site.", chargeFrom: "channel",
      }));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.kind).toBe("not_here");
  });

  it("refuses to cancel a guest who has already arrived", async () => {
    const made = await session((client) =>
      createChannelBooking(client, ownerStaffId, booking("SU-CHAN-7")));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await sql("update reservations set status = 'checked_in' where id = $1",
      [made.reservationIds[0]]);

    const result = await session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-7",
        reason: "Cancelled on the site.", chargeFrom: "channel",
      }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("arrived");

    await sql("update reservations set status = 'confirmed' where id = $1",
      [made.reservationIds[0]]);
  });

  it("will not take a cancellation with no reason, or under the hotel's own terms", async () => {
    const noReason = await session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-5",
        reason: "   ", chargeFrom: "channel",
      }));
    expect(noReason.ok).toBe(false);

    const wrongTerms = await session((client) =>
      cancelChannelBooking(client, ownerStaffId, {
        hotelId, bookingSourceId: agoda, externalRef: "SU-CHAN-5",
        reason: "Cancelled on the site.",
        chargeFrom: "hotel" as unknown as "channel",
      }));
    expect(wrongTerms.ok).toBe(false);
  });
});
