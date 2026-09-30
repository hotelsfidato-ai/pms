import pg from "pg";
import { fileURLToPath } from "node:url";
import {
  property, roomInventory, PROPERTY_ID, EXTRA_ROOM_DATES,
} from "../../src/data/fixtures/property.ts";
import { stays, folios, groups } from "../../src/data/fixtures/reservations.ts";
import { databaseForScript } from "./scriptDatabase.ts";
import { ANCHOR, shift } from "./demoDate.ts";

/* ══════════════════════════════════════════════════════════════════
   LOAD THE DEMO PROPERTY INTO POSTGRES

   CP9 swaps the repositories from an in-memory store onto HTTP. That
   is only a fair test of the seam if BOTH SIDES HOLD THE SAME DATA —
   otherwise every screen changes its numbers at the same moment its
   transport changes, and there is no way to tell a transport bug from
   a data difference.

   So this reads the fixtures — the same module the frontend reads,
   with its import-time assertions still in force — and writes them
   into Postgres. The calibration survives the swap:

       431 available room-nights · 132 sold · 30.63%
       ADR ₹3,178.63 · RevPAR ₹973.50

   ⚠ CONNECTS AS A SUPERUSER, DELIBERATELY.
     This is a bulk administrative load, not an application operation.
     It creates a property, its rooms and eighty-odd reservations
     across every guest — no single staff member has the RLS scope to
     do that, and giving `pms_app` a role that could would defeat the
     policies the rest of the system depends on.

     Nothing in `api/src` may follow this example. That code connects
     as `pms_app` and always will.

   Run:  cd api && npx tsx scripts/load-demo.ts
   ══════════════════════════════════════════════════════════════════ */

const CONNECTION = databaseForScript("load-demo");

const HOTEL_CODE = "5EL";

/* ── Vocabulary maps ─────────────────────────────────────────────── */

/** The fixture calls it `status`; the schema splits clean from held-back. */
const HOUSEKEEPING: Record<string, string> = {
  clean: "clean",
  dirty: "dirty",
  inspected: "inspected",
  "out-of-service": "out_of_service",
  "out-of-order": "out_of_order",
};

/**
 * `due-out` has no database status, and should not have one: it is
 * `checked_in` AND departing today — a view of the business date, not
 * a stored fact. Storing it would need a nightly job to stay true and
 * would be wrong between midnight and that job.
 */
const RESERVATION_STATUS: Record<string, string> = {
  "due-in": "confirmed",
  "in-house": "checked_in",
  "due-out": "checked_in",
  "checked-out": "checked_out",
  "no-show": "no_show",
  cancelled: "cancelled",
};

const OTA = new Set(["Agoda", "Booking.com", "Expedia", "go-MMT"]);

const sourceKind = (source: string) =>
  source === "Walk-in" ? "walk_in" : OTA.has(source) ? "ota" : "direct";

/** Only sources that carry an account become companies. A walk-in has none. */
const COMPANY_SOURCES = ["Agoda", "Booking.com", "Expedia", "go-MMT", "Fidato Hotels"];

const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };
const TYPE_CODE: Record<string, string> = { Superior: "SUP", Deluxe: "DLX" };

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── Load ────────────────────────────────────────────────────────── */

async function main() {
  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();

  const say = (s: string) => console.log(`  ${s}`);

  try {
    /* The cleanup is its own transaction, deliberately.

       It was originally inside the load, with the trigger restores in
       a `finally`. When the DELETE failed, those restores ran against
       an already-aborted transaction, failed in turn, and replaced the
       real error with "current transaction is aborted" — so the actual
       cause was invisible. A cleanup that hides why it could not clean
       up is worse than one that simply stops. */
    const existing = await client.query<{ id: string }>(
      "select id from hotels where code = $1",
      [HOTEL_CODE],
    );
    if (existing.rows.length) {
      /* Every guard that refuses a DELETE stands in the way, and every one
         is correct: a property is not deleted casually, a ledger posting is
         reversed and never removed, an issued invoice is immutable, a paid
         bill's lines are frozen (and Postgres drops the order before the
         cascade reaches its lines, so the trigger sees a NULL status), a
         stock or equipment movement is append-only.

         They are READ FROM THE CATALOGUE, not listed here. The list was
         written by hand and every service that added an append-only table
         after it broke this script (stock_movements, equipment_history,
         equipment_moves, pos_line_events, pos_order_tenders; 21 September).

         They are lifted inside this one transaction and restored before it
         commits, exactly as migration 017 does for the placeholder seed.
         Reloading a demo property is an administrative act; nothing in
         `api/src` may do this. */
      await client.query("begin");
      const guards = (await client.query<{ tbl: string; trg: string }>(
        `select c.relname as tbl, t.tgname as trg
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal
            and t.tgenabled <> 'D'
            and (t.tgtype & 10) = 10`, /* BEFORE (2) and DELETE (8) */
      )).rows;
      for (const g of guards) {
        await client.query(`alter table ${g.tbl} disable trigger ${g.trg}`);
      }
      /* Order matters, and the constraints spell it out.

         `reservation_groups.lead_hotel_id` has no ON DELETE CASCADE —
         correct, because a group may span several properties and must
         not vanish with one of them. And `reservations.group_id` points
         AT the group, so the reservations have to release it before the
         group can go — and the hotel cannot go while the group still
         names it. So the sequence is: unlink the reservations, drop the
         group, then drop the hotel, which cascades the rest. */
      await client.query(
        `update reservations set group_id = null
          where hotel_id = (select id from hotels where code = $1)`,
        [HOTEL_CODE],
      );
      /* A MASTER FOLIO NAMES THE GROUP TOO (056). Unlinking the
         reservations is no longer enough: a group's host account points
         straight at it, and `folios.group_id` has no cascade — deliberately,
         because a financial record should not disappear because something
         upstream was tidied. It carries hotel_id, so it WOULD have gone with
         the hotel; the hotel is dropped after the group, so it has to go
         first and explicitly. Its postings go with it, and the ledger's
         append-only trigger is already lifted for the whole teardown above,
         and re-arming it here breaks every delete that comes after. */
      await client.query(
        `delete from folio_postings where folio_id in (
           select f.id from folios f
            join reservation_groups g on g.id = f.group_id
           where g.lead_hotel_id = (select id from hotels where code = $1))`,
        [HOTEL_CODE],
      );
      await client.query(
        `delete from folios where group_id in (
           select id from reservation_groups
            where lead_hotel_id = (select id from hotels where code = $1))`,
        [HOTEL_CODE],
      );
      await client.query(
        `delete from reservation_groups
          where lead_hotel_id = (select id from hotels where code = $1)`,
        [HOTEL_CODE],
      );
      /* A ROW THAT NAMES THE HOTEL WITHOUT A CASCADE goes first, read from
         the catalogue like the guards. The hotel's cascade reaches a kitchen
         timing through its order, but the timing's own hotel_id is checked
         before that, so a demo whose kitchen had been used would not reload
         (pos_line_events_hotel_id_fkey, 30 September). */
      const strays = (await client.query<{ tbl: string; col: string }>(
        `select c.conrelid::regclass::text as tbl, a.attname as col
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.confrelid = 'hotels'::regclass
            and c.confdeltype in ('a', 'r')
            and c.conrelid <> 'reservation_groups'::regclass`,
      )).rows;
      for (const s of strays) {
        await client.query(
          `delete from ${s.tbl} where ${s.col} = (select id from hotels where code = $1)`,
          [HOTEL_CODE],
        );
      }
      await client.query("delete from hotels where code = $1", [HOTEL_CODE]);

      /* ── The guests the hotel left behind ────────────────────────
         `guests` carries no hotel_id — a guest belongs to the GROUP, so a
         returning one does not re-present their passport at each property
         (013_policies.sql). Which means dropping the hotel cascades its
         reservations and leaves every guest standing.

         Reloading eight times left 279 guest rows behind a demo that claims
         30, and 214 of them had no stay anywhere. The Directory counted
         them; app.identity_missing() scanned them. Nobody noticed, because
         nothing had ever counted guests against the figure the demo
         promises.

         Only those with NO reservation at ANY property go: a guest shared
         with Agra or Pune is still somebody's guest. */
      const orphans = await client.query(
        `delete from guests g
          where not exists (select 1 from reservations r
                             where r.guest_id = g.id)`,
      );
      if (orphans.rowCount) {
        say(`released ${orphans.rowCount} guests with no remaining stay`);
      }
      for (const g of guards) {
        await client.query(`alter table ${g.tbl} enable trigger ${g.trg}`);
      }
      await client.query("commit");
      say(`removed the previous ${HOTEL_CODE}`);
    }

    await client.query("begin");

    /* ── The property ─────────────────────────────────────────────
       Inserted directly rather than through app.provision_property(),
       which clones room types from the group templates. This property
       has its own two, taken from the real exports. */
    const { rows: [hotel] } = await client.query<{ id: string }>(
      /* business_date pins the property to the day the export was
         taken. Without it the column defaults to current_date and the
         demo silently reports whatever day the loader ran on — every
         arrival list empty, every occupancy figure zero, and nothing
         to point at as the cause. */
      `insert into hotels (code, name, city, state, gstin, timezone,
                           check_in_time, check_out_time,
                           address_line, phone, email, cgst_rate, sgst_rate,
                           business_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning id`,
      [
        HOTEL_CODE, property.name, "Akkalkot", "MH", property.gstin,
        property.timezone, property.checkInTime, property.checkOutTime,
        property.address, property.phone, property.email,
        property.tax.cgst, property.tax.sgst, BUSINESS_DATE,
      ],
    );
    const hotelId = hotel!.id;
    say(`${property.name} (${HOTEL_CODE})`);

    /* ── GST, which a property cannot trade without ────────────────
       067 moved the rate out of `hotels.cgst_rate + sgst_rate` and into
       `tax_rules`, because one flat pair cannot express a rate that
       turns on what a room costs. `app.gst_rate()` RAISES when a kind
       has no rule — it does not fall back to zero — so a demo property
       loaded without these cannot take a walk-in or close a night, and
       the failure surfaces three screens away as "something went
       wrong".

       The fixture's `tax.cgst + tax.sgst` is the rate it was built
       with, so the demo's existing arithmetic still reconciles. The
       higher band is the statutory one above the tariff threshold; no
       demo room reaches it, which is exactly why it is worth having
       here — the boundary gets exercised by the assertions, not by the
       fixture. */
    const demoRate = property.tax.cgst + property.tax.sgst;
    await client.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1,'room',       0,    $2, 'At or under the threshold'),
              ($1,'room',       7500, 18, 'Above the threshold'),
              ($1,'restaurant', 0,    $2, 'Food and soft drink')`,
      [hotelId, demoRate],
    );

    /* ── Room types and rooms ─────────────────────────────────────
       All 18 physical rooms, including 308 held out of service. The
       17/18 split is what makes the occupancy arithmetic close, so it
       has to survive the load intact. */
    const typeIds = new Map<string, string>();
    for (const [i, type] of ["Superior", "Deluxe"].entries()) {
      const of = roomInventory.filter((r) => r.type === type);
      const { rows: [rt] } = await client.query<{ id: string }>(
        `insert into room_types (hotel_id, code, name, base_occupancy,
                                 max_occupancy, base_rate, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          hotelId, TYPE_CODE[type], type, 2,
          Math.max(...of.map((r) => r.maxOccupancy)), RACK[type] ?? 0, i,
        ],
      );
      typeIds.set(type, rt!.id);
    }

    const roomIds = new Map<string, string>();
    for (const room of roomInventory) {
      const { rows: [r] } = await client.query<{ id: string }>(
        `insert into rooms (hotel_id, room_type_id, number, floor,
                            housekeeping_status)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          hotelId, typeIds.get(room.type), room.number, room.floor,
          HOUSEKEEPING[room.status] ?? "clean",
        ],
      );
      roomIds.set(room.number, r!.id);
    }
    const sellable = roomInventory.filter((r) => r.status !== "out-of-service").length;
    say(`${roomInventory.length} rooms · ${sellable} sellable · 2 room types`);

    /* ── Room blocks — the availability curve ─────────────────────
       Room 308 is out of service, EXCEPT for 8–13 August, when the
       real Monthly Statistics export shows 18 available rooms instead
       of 17. That week is what makes the arithmetic close:

           19 × 17 + 6 × 18 = 431 available room-nights
           132 / 431        = 30.63%

       Until migration 022 this curve lived only in a TypeScript
       fixture, so every occupancy figure in the product was reading a
       number the database did not know. Now it is two blocks either
       side of the week the room was back, and the 431 is DERIVED. */
    const blocked = roomInventory.filter((r) => r.status === "out-of-service");
    for (const room of blocked) {
      const back = EXTRA_ROOM_DATES.map(shift).sort();
      const first = back[0];
      const last = back[back.length - 1];

      if (!first || !last) {
        await client.query(
          `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, note)
           values ($1, $2, '2026-01-01', null, 'out_of_service', $3)`,
          [hotelId, roomIds.get(room.number), "Held out of service."],
        );
        continue;
      }

      await client.query(
        `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, note)
         values ($1, $2, '2026-01-01', $3::date - 1, 'out_of_service', $4),
                ($1, $2, $5::date + 1, null,        'out_of_service', $4)`,
        [hotelId, roomIds.get(room.number), first,
         `Back in inventory ${first} to ${last} — see the Monthly Statistics export.`,
         last],
      );
    }
    say(`${blocked.length} room blocked, back in inventory for ${EXTRA_ROOM_DATES.length} days`);

    /* ── Guests ───────────────────────────────────────────────────
       Grouped by name, which is exactly what the interface does. The
       fixture has no other identifier, and inventing one here would
       make the two sides disagree about who is a repeat guest. */
    /* On the demo's day (demoDate.ts): every date below is read from here. */
    const mine = stays.filter((s) => s.hotelId === PROPERTY_ID)
      .map((s) => ({ ...s, arrival: shift(s.arrival), departure: shift(s.departure) }));
    const guestIds = new Map<string, string>();
    for (const name of [...new Set(mine.map((s) => s.guest))]) {
      const { rows: [g] } = await client.query<{ id: string }>(
        "insert into guests (full_name) values ($1) returning id",
        [name],
      );
      guestIds.set(name, g!.id);
    }
    say(`${guestIds.size} guests`);

    /* Meal plans are group reference data and belong to a MIGRATION.
       This used to insert the 'Room Only' row itself, which is how a
       group ends up with a plan nobody chose. It now lives in
       020_deferred_fixes.sql (D2) and this only maps onto it. */
    const MEAL_PLAN: Record<string, string> = {
      CP: "CP", EP: "EP", MAP: "MAP", AP: "AP", "Room Only": "RO",
    };

    const companyIds = new Map<string, string>();
    for (const name of COMPANY_SOURCES) {
      const { rows: [c] } = await client.query<{ id: string }>(
        "insert into companies (name) values ($1) returning id",
        [name],
      );
      companyIds.set(name, c!.id);
    }

    /* ── Groups ───────────────────────────────────────────────────
       The Pancham Hall block is three rooms under ONE booking
       reference — which is how a hotel takes a group, and which the
       unique index on (hotel_id, reference) will not have.

       That index is right: a reference has to identify one bookable
       thing, or a clerk searching for FH-2608-5010 gets three answers
       and no way to tell which room they are billing. So the group
       owns the shared reference and each member carries its own,
       suffixed by room. The API returns the GROUP's reference for
       display when a reservation has a group_id, so the screens keep
       showing what the guest was quoted. */
    const groupIds = new Map<string, string>();
    for (const g of groups.filter((g) => g.hotelId === PROPERTY_ID)) {
      const { rows: [row] } = await client.query<{ id: string }>(
        `insert into reservation_groups (name, block_code, lead_hotel_id, notes)
         values ($1, $2, $3, $4) returning id`,
        [g.name, g.reference, hotelId, `${g.rooms} rooms, ${shift(g.arrival)} to ${shift(g.departure)}`],
      );
      groupIds.set(g.id, row!.id);
    }
    if (groupIds.size) say(`${groupIds.size} group booking`);

    /* ── Reservations, assignments, folios, postings ──────────────
       The reference comes from the fixture rather than the per-hotel
       sequence: it appears on screen and in the demo exports, and a
       regenerated number would break every screenshot. */
    const folioByStay = new Map(folios.map((f) => [f.stayId, f]));
    let assignments = 0;
    let postings = 0;

    for (const stay of mine) {
      const status = RESERVATION_STATUS[stay.status] ?? "confirmed";

      /* Day-use is native. Migration 015 relaxed the date constraint to
         `check_out >= check_in` and made `is_day_use` a GENERATED column
         (`check_out = check_in`), so the dates go in untouched and the
         schema works out what kind of stay it is.

         Pushing a day-use departure to the next day — which is what a
         reading of the original 005 constraint would suggest — would
         turn every one of them into an overnight stay and put a wrong
         Day Use Room figure on the Manager Report. */
      const checkOut = stay.departure;

      /* There is no `reservations.room_id`. Migration 011 replaced it
         with `room_assignments`, because a single column could only
         ever hold one room and a guest who moves mid-stay needs two.
         The flat `Stay.roomNumber` the screens read is a reservation
         JOINED to its assignment — that join is CP9's real work. */
      const { rows: [res] } = await client.query<{ id: string }>(
        `insert into reservations
           (hotel_id, reference, guest_id, company_id, room_type_id,
            check_in, check_out, adults, children, occupancy,
            agreed_rate, status, source, meal_plan, group_id,
            is_complimentary)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         returning id`,
        [
          hotelId,
          /* Unique per hotel. A group member's own reference is the
             group's plus its room; the group keeps the bare one. */
          stay.groupId ? `${stay.reference}-${stay.roomNumber}` : stay.reference,
          guestIds.get(stay.guest),
          companyIds.get(stay.source) ?? null,
          typeIds.get(stay.roomType),
          stay.arrival, checkOut, stay.adults, stay.children,
          stay.adults + stay.children,
          stay.offeredTariff, status, sourceKind(stay.source),
          MEAL_PLAN[stay.ratePlan] ?? null,
          stay.groupId ? groupIds.get(stay.groupId) ?? null : null,
          /* A decision, not a price. Migration 020 gave it a column;
             before that the only marker was agreed_rate = 0, which is
             a different fact that happened to coincide. */
          stay.isComplimentary,
        ],
      );
      const reservationId = res!.id;

      /* A cancelled or no-show booking holds no room. Without the
         explicit release the assignment would block that room forever
         — the comment on room_assignments says so in the schema.

         Confirmed bookings DO get one: the fixture pre-assigns rooms,
         the tape chart draws a bar for every arrival, and a chart with
         no arrivals on it is not the chart this product has. */
      if (status !== "cancelled" && status !== "no_show") {
        await client.query(
          `insert into room_assignments
             (hotel_id, reservation_id, room_id, from_date, to_date, released_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            hotelId, reservationId, roomIds.get(stay.roomNumber),
            stay.arrival, checkOut,
            status === "checked_out" ? `${checkOut}T11:00:00+05:30` : null,
          ],
        );
        assignments += 1;
      }

      const folio = folioByStay.get(stay.id);
      if (!folio) continue;

      const { rows: [f] } = await client.query<{ id: string }>(
        `insert into folios (hotel_id, reservation_id, status)
         values ($1, $2, $3) returning id`,
        [hotelId, reservationId, status === "checked_out" ? "closed" : "open"],
      );
      const folioId = f!.id;

      const line = async (
        date: string, category: string, description: string,
        amount: number, tax: number,
      ) => {
        const { rows: [made] } = await client.query<{ id: string }>(
          `insert into folio_postings
             (hotel_id, folio_id, business_date, category, description,
              amount, tax_rate, tax_amount)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           returning id::text`,
          [hotelId, folioId, date, category, description,
           round2(amount), tax ? 5 : 0, round2(tax)],
        );
        postings += 1;

        /* A payment is TWO rows: the posting is the money, the
           `payments` row is how it arrived. The endpoint writes both;
           this wrote only the posting, so the Manager Report — which
           breaks receipts down by method — showed ₹0 while the Monthly
           Statistics grid showed ₹3,97,041. Two screens, one truth,
           and the seed was the one lying. */
        if (category === "payment") {
          await client.query(
            `insert into payments (hotel_id, posting_id, method, amount)
             values ($1, $2::bigint, 'cash', $3)`,
            [hotelId, made!.id, round2(-amount)],
          );
        }
      };

      /* Charges post when the guest is in the house. A booking that
         has not arrived carries an empty folio — the same rule the
         in-memory store learned at CP6, for the same reason. */
      if (stay.arrival > BUSINESS_DATE) continue;

      const nights = stay.nights || 1;

      /* `fp_tax_consistent` (migration 015) requires
             tax_amount = round(amount * tax_rate / 100, 2)
         to the cent. The fixture carries ONE tax figure for the whole
         folio, and in 2 of the 83 it is more than 5% of the room
         charge — the tax there also covers extras, or several rooms on
         one group folio.

         Forcing a rate that reproduced the total would fail the check
         on a large amount, and silently dropping the difference would
         lose money from the Lodging Tax report. So the room line
         carries statutory 5% and any remainder posts as its own `tax`
         line. The total is preserved exactly and the discrepancy is
         visible on the folio rather than absorbed. */
      const roomTax = round2(folio.roomCharges * 0.05);

      if (folio.roomCharges > 0) {
        await line(
          stay.arrival, "room",
          `Room ${stay.roomNumber} · ${nights} night${nights === 1 ? "" : "s"}`,
          folio.roomCharges, roomTax,
        );
      }
      if (folio.extraCharges > 0) {
        await line(stay.arrival, "misc", "Extras", folio.extraCharges, 0);
      }

      const remainder = round2(folio.tax - (folio.roomCharges > 0 ? roomTax : 0));
      if (Math.abs(remainder) >= 0.01) {
        await line(stay.arrival, "tax", "Tax on extras", remainder, 0);
      }
      if (folio.discount > 0) {
        await line(stay.arrival, "discount", "Discount", -folio.discount, 0);
      }

      /* A receipt cannot be dated after today. A departed stay settles
         at check-out; one still in the house shows what was taken at
         check-in; an unarrived booking carries none. */
      if (folio.payments > 0) {
        const receivedOn =
          checkOut <= BUSINESS_DATE ? { date: checkOut, label: "Settlement" }
            : { date: stay.arrival, label: "Deposit at check-in" };
        await line(receivedOn.date, "payment", receivedOn.label, -folio.payments, 0);
      }
    }

    /* ── Room occupancy ───────────────────────────────────────────
       `rooms.occupancy_status` was left at its 'vacant' default, so
       Postgres said the house was empty while the reservations said
       seven rooms were in it. The housekeeping board reads the room;
       the tape chart reads the stays; they disagreed by one room and
       neither was obviously wrong on its own screen.

       A room is occupied if somebody is checked into it tonight. That
       is derivable, so it is derived rather than typed in. */
    const occupied = await client.query(
      `update rooms r set occupancy_status = 'occupied'
        where r.hotel_id = $1
          and exists (
            select 1
              from room_assignments ra
              join reservations res on res.id = ra.reservation_id
             where ra.room_id = r.id
               and ra.released_at is null
               and res.status = 'checked_in'
               /* Inclusive of the departure day. A guest who is DUE OUT
                  is still in the room until they check out — that is
                  what "due out" means, and it is why the tape chart
                  counted seven rooms while an exclusive range counted
                  six. The room releases at check-out, not at midnight. */
               and $2::date between ra.from_date and ra.to_date
          )`,
      [hotelId, BUSINESS_DATE],
    );

    say(`${mine.length} reservations · ${assignments} assignments · ${postings} postings`);
    say(`${occupied.rowCount} rooms occupied on ${BUSINESS_DATE}`);

    /* ── Access ───────────────────────────────────────────────────
       The demo staff already exist (db/tests/suite.sql). The owner is
       a group admin and needs no grant; the Agra clerk gets one here
       so there is somebody scoped to exactly this property. */
    await client.query(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select s.id, $1, 'front_desk' from staff s where s.email = 'agra@fidato.in'
       on conflict do nothing`,
      [hotelId],
    );

    /* ── Prove it reconciles, BEFORE committing ───────────────────
       This check first ran after the commit, so the first failing load
       reported drift and left the wrong data in the database anyway.
       A verification that cannot prevent what it verifies is a report,
       not a check.

       It asks Postgres the same question the Manager Report asks. */
    /* "Sold" excludes three things, and each exclusion is a business
       fact rather than a filter:

         cancelled / no-show   never occupied the room
         day-use               occupies no NIGHT — check_out = check_in,
                               so generate_series yields nothing and the
                               exclusion is structural rather than stated
         complimentary         occupied but not sold; the Manager Report
                               prints it on its own line

       Complimentary now has its own column (migration 020, D1). It was
       inferred from `agreed_rate = 0` until then, which works only
       while nothing else is booked at zero — a comp is a decision, a
       zero rate is a price, and they merely coincided here. */
    /* Availability is now DERIVED, so the 431 is a check on the
       database rather than a number the product carries. */
    const { rows: [avail] } = await client.query<{ nights: string }>(
      `select sum(app.sellable_rooms($1, d::date))::text as nights
         from generate_series($2::date, $3::date, interval '1 day') d`,
      [hotelId, shift("2026-08-01"), BUSINESS_DATE],
    );
    const availableNights = Number(avail!.nights);

    const { rows: [check] } = await client.query<{ sold: string }>(
      `select count(*)::text as sold
         from reservations r, generate_series(r.check_in, r.check_out - 1, interval '1 day') d
        where r.hotel_id = $1
          and r.status in ('confirmed','checked_in','checked_out')
          and not r.is_complimentary
          and d::date between $2::date and $3::date`,
      [hotelId, shift("2026-08-01"), BUSINESS_DATE],
    );
    const sold = Number(check!.sold);

    if (availableNights !== 431) {
      throw new Error(
        `Calibration drift: Postgres says ${availableNights} available ` +
          `room-nights over 1–25 August; the real Monthly Statistics export ` +
          `says 431 (19 days x 17 rooms + 6 days x 18). Occupancy divides by ` +
          `this, so every percentage in the product would be wrong. Nothing ` +
          `was committed.`,
      );
    }

    /* ── A menu to sell from ──────────────────────────────────────────
       Here and NOT in a migration, for the same reason the guest names
       are here: these are invented. Nobody has seen Sattva's card, so
       these dishes and these prices are a demonstration, not Fidato's
       menu. A migration that shipped them would put invented rupees on
       a screen that looks like the real system.

       The hotel enters its own through /h/:code/till/menu. When it
       does, this seed stops mattering. */
    const MENU: [string, [string, number, number][]][] = [
      ["Starters", [
        ["Paneer Tikka", 320, 5], ["Veg Manchurian", 280, 5],
        ["Chicken 65", 360, 5], ["Papad Masala", 90, 5],
      ]],
      ["Main course", [
        ["Dal Tadka", 260, 5], ["Paneer Butter Masala", 340, 5],
        ["Chicken Curry", 420, 5], ["Veg Biryani", 310, 5],
        ["Jeera Rice", 180, 5], ["Butter Roti", 40, 5],
      ]],
      ["Beverages", [
        /* Packaged water is 18% and not 5%. A bill mixing rates is the
           normal case, which is why tax lives on the item. */
        ["Masala Chai", 60, 5], ["Fresh Lime Soda", 120, 5],
        ["Packaged Water 1L", 40, 18], ["Cold Coffee", 160, 5],
      ]],
      ["Desserts", [
        ["Gulab Jamun", 140, 5], ["Ice Cream", 120, 5],
      ]],
    ];

    for (const [category, items] of MENU) {
      const { rows: [cat] } = await client.query<{ id: string }>(
        `insert into pos_menu_categories (hotel_id, name, sort_order)
         values ($1,$2,$3)
         on conflict (hotel_id, name) do update set is_active = true
         returning id`,
        [hotelId, category, MENU.findIndex(([c]) => c === category)],
      );
      for (const [name, price, tax] of items) {
        await client.query(
          `insert into pos_menu_items
             (hotel_id, category_id, name, price, tax_rate)
           values ($1,$2,$3,$4,$5)
           on conflict (hotel_id, category_id, name)
             do update set price = excluded.price, tax_rate = excluded.tax_rate`,
          [hotelId, cat!.id, name, price, tax],
        );
      }
    }

    /* ── THE FLOOR ───────────────────────────────────────────────
       A/C, Non A/C and Bar, because that is how a real restaurant is
       divided and how a waiter finds a table — by walking to a section
       first. A flat list of thirty is a list nobody scans.

       Seeded AFTER the outlet exists, below. */
    /* ── ONE DISH THAT IS NOT ONE PRICE ──────────────────────────
       Every other item on this menu is name-price-tax, which is what
       most of a menu is. This one is the shape the rest of the trade
       assumes: a variation carrying the price, and sides that print
       indented under the dish on the kitchen docket.

       Seeded because the feature is invisible without it — a menu with
       no variations makes the dialog look like dead code. */
    const { rows: [starters] } = await client.query<{ id: string }>(
      `select id from pos_menu_categories
        where hotel_id = $1 and name = 'Starters'`, [hotelId]);

    if (starters) {
      const { rows: [dish] } = await client.query<{ id: string }>(
        `insert into pos_menu_items
           (hotel_id, category_id, name, price, tax_rate, short_code, is_veg)
         values ($1,$2,'Bhaaji Pau',300,5,'BP',true)
         on conflict (hotel_id, category_id, name) do update
            set short_code = excluded.short_code, is_veg = excluded.is_veg
         returning id`,
        [hotelId, starters.id]);

      for (const [label, price, sort] of [
        ["Oil", 300, 1], ["Butter", 400, 2],
      ] as [string, number, number][]) {
        await client.query(
          `insert into pos_item_variations
             (hotel_id, item_id, label, price, sort_order)
           values ($1,$2,$3,$4,$5)
           on conflict (item_id, type_no, label) do update set price = excluded.price`,
          [hotelId, dish!.id, label, price, sort]);
      }

      const { rows: [group] } = await client.query<{ id: string }>(
        `insert into pos_addon_groups (hotel_id, label, min_select, max_select)
         values ($1,'Sides',0,4)
         on conflict (hotel_id, label) do update set max_select = 4
         returning id`, [hotelId]);

      for (const [label, sort] of [
        ["Onions", 1], ["Coriander Chutney", 2],
        ["Curd", 3], ["Pudina Chutney", 4],
      ] as [string, number][]) {
        await client.query(
          `insert into pos_addons (hotel_id, group_id, label, price, sort_order)
           values ($1,$2,$3,25,$4)
           on conflict (group_id, label) do update set price = 25`,
          [hotelId, group!.id, label, sort]);
      }

      await client.query(
        `insert into pos_item_addon_groups (item_id, group_id)
         values ($1,$2) on conflict do nothing`,
        [dish!.id, group!.id]);
    }

    /* An outlet for the till to open orders against. The BRIDGE outlets
       carry an api_key_hash because a machine authenticates with one;
       this one has none, because the people using it authenticate as
       themselves. That is the difference between the two doors. */
    const { rows: [tillStaff] } = await client.query<{ id: string }>(
      `select id from staff where email = 'owner@fidato.in'`,
    );
    await client.query(
      `insert into pos_outlets (hotel_id, code, name, category, staff_id)
       values ($1,'REST','Fidato Restaurant','food',$2)
       on conflict (hotel_id, code) do nothing`,
      [hotelId, tillStaff!.id],
    );


    /* The room. Three sections, laid out in a grid a waiter can learn:
       the same table is always in the same place, which is what makes
       muscle memory work on a screen that is jabbed at.

       No colour is stored on any of this — the tile derives it from the
       order sitting on the table. */
    const { rows: [restOutlet] } = await client.query<{ id: string }>(
      `select id from pos_outlets where hotel_id = $1 and code = 'REST'`,
      [hotelId]);

    const FLOOR: [string, number, string[]][] = [
      ["A/C", 1, ["AC1", "AC2", "AC3", "AC4", "AC5", "AC6",
                  "AC7", "AC8", "AC9", "AC10"]],
      ["Non A/C", 2, ["N1", "N2", "N3", "N4", "N5", "N6"]],
      ["Bar", 3, ["B1", "B2", "B3", "B4"]],
    ];

    for (const [name, order, labels] of FLOOR) {
      const { rows: [section] } = await client.query<{ id: string }>(
        `insert into pos_sections (hotel_id, outlet_id, name, sort_order)
         values ($1,$2,$3,$4)
         on conflict (outlet_id, name) do update set is_active = true
         returning id`,
        [hotelId, restOutlet!.id, name, order]);

      for (const [i, label] of labels.entries()) {
        await client.query(
          `insert into pos_tables
             (hotel_id, section_id, label, seats, row_no, col_no)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (section_id, label) do nothing`,
          /* Four across, which is what fits a terminal held in portrait
             without the tiles becoming too small to hit. */
          [hotelId, section!.id, label, i % 3 === 0 ? 6 : 4,
           Math.floor(i / 4), i % 4]);
      }
    }

    /* THE DAY MOVED WITH THE BOOKINGS (D27-193). A date left unshifted puts
       the snapshot's arrivals off the business date, which is the owner's
       "my booking is not in Arrivals" the other way round. */
    const { rows: [due] } = await client.query<{ n: string }>(
      `select count(*)::text as n from reservations
        where hotel_id = $1 and check_in = (select business_date from hotels where id = $1)`,
      [hotelId],
    );
    const snapshotDue = stays.filter((s) => s.hotelId === PROPERTY_ID && s.arrival === ANCHOR).length;
    if (Number(due!.n) !== snapshotDue) {
      throw new Error(
        `${due!.n} bookings arrive on the business date ${BUSINESS_DATE}; the snapshot has ` +
          `${snapshotDue} arriving on ${ANCHOR}. A date did not move with the demo. ` +
          `Nothing was committed.`,
      );
    }

    if (sold !== 132) {
      throw new Error(
        `Calibration drift: Postgres says ${sold} room-nights sold in the PTD ` +
          `window, the fixtures and the real Night Audit say 132. The load is ` +
          `not a faithful copy, so CP9 cannot tell a transport bug from a data ` +
          `one. Nothing was committed.`,
      );
    }

    await client.query("commit");
    console.log();
    say(`available room-nights 1–25 August: ${availableNights}`);
    say(`room-nights sold 1–25 August: ${sold}`);
    say(`occupancy: ${((sold / availableNights) * 100).toFixed(2)}%`);
    say("matches the fixtures and the real Night Audit export ✓");

    /* No guest left standing without a stay.
    
       `guests` has no hotel_id, so dropping the property cascades its
       reservations and leaves the people behind. Eight reloads had put
       279 rows behind a demo that promises 30, and nothing counted.
       Verified here rather than trusted, because the cleanup is three
       lines above and a cleanup nobody measures is one nobody knows
       failed. */
    const stranded = await client.query<{ n: string }>(
      `select count(*)::text as n from guests g
        where not exists (select 1 from reservations r
                           where r.guest_id = g.id)`,
    );
    if (Number(stranded.rows[0]!.n) > 0) {
      throw new Error(
        `${stranded.rows[0]!.n} guests have no stay at any property. ` +
          `Each reload leaks the previous set, and the Directory counts ` +
          `them.`,
      );
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * The day the demo dataset is anchored to.
 *
 * NOT the business date the application reads — that comes from
 * app.business_date() per property, and this value is what gets
 * WRITTEN into hotels.business_date so the two agree. The snapshot's
 * day is 25 August (431 available room-nights, 132 sold, ADR ₹3,178.63
 * and room revenue ₹4,19,578.76 reconcile to the real eZee Night Audit
 * export for 1–25 August 2026); `--today` moves it, and every date with
 * it, onto today (demoDate.ts), so the same figures land on the days
 * before today.
 */
const BUSINESS_DATE = shift(ANCHOR);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("\n  load-demo failed:", error.message, "\n");
    process.exit(1);
  });
}
