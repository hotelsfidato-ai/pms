import pg from "pg";
import { fileURLToPath } from "node:url";
import {
  property, roomInventory, PROPERTY_ID, EXTRA_ROOM_DATES,
} from "../../src/data/fixtures/property.ts";
import { stays, folios, groups } from "../../src/data/fixtures/reservations.ts";

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

const CONNECTION =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

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
      /* Two guards stand in the way, and both are correct:

           hotels_no_delete             a property is not deleted casually
           folio_postings_append_only   a wrong posting is REVERSED, never
                                        removed — the ledger is the record

         Neither is a nuisance to route around. They are lifted for these
         statements only and restored immediately, exactly as migration
         017 does for the placeholder seed. Reloading a demo property is
         an administrative act; nothing in `api/src` may do this. */
      await client.query("begin");
      await client.query("alter table hotels disable trigger hotels_no_delete");
      await client.query(
        "alter table folio_postings disable trigger folio_postings_append_only",
      );
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
      await client.query(
        `delete from reservation_groups
          where lead_hotel_id = (select id from hotels where code = $1)`,
        [HOTEL_CODE],
      );
      await client.query("delete from hotels where code = $1", [HOTEL_CODE]);
      await client.query(
        "alter table folio_postings enable trigger folio_postings_append_only",
      );
      await client.query("alter table hotels enable trigger hotels_no_delete");
      await client.query("commit");
      say(`removed the previous ${HOTEL_CODE}`);
    }

    await client.query("begin");

    /* ── The property ─────────────────────────────────────────────
       Inserted directly rather than through app.provision_property(),
       which clones room types from the group templates. This property
       has its own two, taken from the real exports. */
    const { rows: [hotel] } = await client.query<{ id: string }>(
      `insert into hotels (code, name, city, state, gstin, timezone,
                           check_in_time, check_out_time,
                           address_line, phone, email, cgst_rate, sgst_rate)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        HOTEL_CODE, property.name, "Akkalkot", "MH", property.gstin,
        property.timezone, property.checkInTime, property.checkOutTime,
        property.address, property.phone, property.email,
        property.tax.cgst, property.tax.sgst,
      ],
    );
    const hotelId = hotel!.id;
    say(`${property.name} (${HOTEL_CODE})`);

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
      const back = [...EXTRA_ROOM_DATES].sort();
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
    const mine = stays.filter((s) => s.hotelId === PROPERTY_ID);
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
        [g.name, g.reference, hotelId, `${g.rooms} rooms, ${g.arrival} to ${g.departure}`],
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
        await client.query(
          `insert into folio_postings
             (hotel_id, folio_id, business_date, category, description,
              amount, tax_rate, tax_amount)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [hotelId, folioId, date, category, description,
           round2(amount), tax ? 5 : 0, round2(tax)],
        );
        postings += 1;
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
         from generate_series(date '2026-08-01', date '2026-08-25', interval '1 day') d`,
      [hotelId],
    );
    const availableNights = Number(avail!.nights);

    const { rows: [check] } = await client.query<{ sold: string }>(
      `select count(*)::text as sold
         from reservations r, generate_series(r.check_in, r.check_out - 1, interval '1 day') d
        where r.hotel_id = $1
          and r.status in ('confirmed','checked_in','checked_out')
          and not r.is_complimentary
          and d::date between date '2026-08-01' and date '2026-08-25'`,
      [hotelId],
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
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** The business date the demo is pinned to. Re-exported by the fixtures. */
const BUSINESS_DATE = "2026-08-25";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("\n  load-demo failed:", error.message, "\n");
    process.exit(1);
  });
}
