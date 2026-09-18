import pg from "pg";
import { fileURLToPath } from "node:url";
import { databaseForScript } from "./scriptDatabase.ts";

/* ══════════════════════════════════════════════════════════════════
   MORE OF THE DEMO — history, and the other two properties

   `load-demo` builds August 2026 at Akkalkot faithfully: 431 available
   room-nights, 132 sold, ADR ₹3,178.63, reconciled to the paisa against
   a real Night Audit export. That fidelity is the point of it and this
   script does not go near it.

   WHAT IT ADDS, and why each is needed:

     5EL, April to July      Yearly Statistics showed eleven months of
                             ₹0 and one with numbers, which reads as a
                             broken report rather than a young property.
                             Year to date on the Manager Report was the
                             same figure as period to date.

     AGR and PUN             10 rooms each and, between them, four
                             bookings. The group dashboard listed three
                             properties and two of them were empty, so
                             the one screen an owner opens first had
                             nothing to compare.

   IT NEVER TOUCHES 1–25 AUGUST 2026 AT AKKALKOT. That window is
   asserted — `load-demo` refuses to commit if room-nights sold there is
   not exactly 132 — and this script would be the obvious suspect the
   day that assertion failed. The guard below is not decoration: it
   counts the window before and after and stops if the number moved.

   RE-RUNNABLE. Everything it writes carries a `DH-` reference, and it
   removes its own rows first. Running it twice does not double the
   history, which is the fault a demo loader is most likely to have and
   the hardest to notice — the figures simply look better.
   ══════════════════════════════════════════════════════════════════ */

const CONNECTION = databaseForScript("demo-history");

const TAG = "DH";

/* Deterministic. A demo that shuffles every load is one where a
   screenshot taken on Tuesday cannot be compared with Wednesday's, and
   where a figure somebody queried yesterday is gone today. */
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const FIRST = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Reyansh", "Ayaan",
  "Krishna", "Ishaan", "Shaurya", "Ananya", "Diya", "Aadhya", "Kavya",
  "Anika", "Navya", "Riya", "Myra", "Sara", "Ira", "Rohan", "Kabir",
  "Meera", "Nisha", "Farhan", "Zoya", "Imran", "Tanvi", "Rahul", "Sneha",
];
const LAST = [
  "Sharma", "Verma", "Patel", "Gupta", "Singh", "Kulkarni", "Deshmukh",
  "Joshi", "Nair", "Iyer", "Reddy", "Rao", "Mehta", "Shah", "Bose",
  "Chatterjee", "Pillai", "Menon", "Khan", "Sheikh",
];

const SOURCES = [
  "Walk-in", "Fidato Hotels", "Agoda", "Expedia", "Booking.com", "go-MMT",
];

interface Made { guests: number; stays: number; postings: number }

async function main() {
  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();
  const say = (s: string) => console.log(`  ${s}`);

  try {
    /* ── The figure that must not move ──────────────────────────── */
    const before = await soldInWindow(client);

    await clearOwnRows(client);

    await client.query("begin");

    const made: Made = { guests: 0, stays: 0, postings: 0 };

    /* Akkalkot: the months BEFORE the calibrated window. April is the
       start of the Indian financial year, which is what "year to date"
       means on every report here. */
    await fill(client, made, {
      code: "5EL",
      from: "2026-04-01",
      to: "2026-07-31",
      /* Roughly a third of the house, which is what this property
         actually ran at before August. Invented occupancy that flatters
         the property would make every rate report a lie. */
      occupancy: 0.34,
      seed: 41,
    });

    /* Agra and Pune: a year of their own, up to their business date.
       They have ten rooms each and were carrying four bookings between
       them, so the group dashboard had nothing to compare. */
    await fill(client, made, {
      code: "AGR", from: "2026-04-01", to: "2026-09-03",
      occupancy: 0.46, seed: 77,
    });
    await fill(client, made, {
      code: "PUN", from: "2026-04-01", to: "2026-09-03",
      occupancy: 0.39, seed: 113,
    });

    /* A restaurant service at Akkalkot: tables open, dishes on the
       pass, some already cooking. Without it the kitchen screen is
       empty and reads as broken. */
    const service = await fillRestaurant(client);

    await client.query("commit");

    /* ── And it did not move ────────────────────────────────────── */
    const after = await soldInWindow(client);
    if (before !== after) {
      throw new Error(
        `1–25 August at Akkalkot moved from ${before} room-nights sold to `
        + `${after}. That window is the calibration the whole project is `
        + `checked against, and this script is not allowed near it.`,
      );
    }

    console.log();
    say(`${made.guests} more guests`);
    say(`${made.stays} more stays · ${made.postings} more postings`);
    say(`${service.orders} open tables · ${service.onThePass} dishes on the pass`);
    say(`1–25 August at Akkalkot: still ${after} room-nights sold ✓`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error(`\n  demo-history failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function soldInWindow(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n
       from reservations r
       join hotels h on h.id = r.hotel_id
       join lateral generate_series(r.check_in,
              r.check_out - 1, interval '1 day') d on true
      where h.code = '5EL'
        and r.status not in ('cancelled', 'no_show')
        and not r.is_complimentary
        and d::date between date '2026-08-01' and date '2026-08-25'`);
  return Number(rows[0]!.n);
}

/** Removes what a previous run of THIS script wrote, and nothing else. */
async function clearOwnRows(client: pg.Client) {
  await client.query("begin");
  await client.query(
    "alter table folio_postings disable trigger folio_postings_append_only");
  await client.query("alter table guests disable trigger guests_no_delete");

  const { rows: mine } = await client.query<{ id: string }>(
    `select id from reservations where reference like $1`, [`${TAG}-%`]);
  const ids = mine.map((r) => r.id);

  if (ids.length) {
    await client.query(
      `delete from payments where posting_id in (
         select fp.id from folio_postings fp
          join folios f on f.id = fp.folio_id
         where f.reservation_id = any($1::uuid[]))`, [ids]);
    await client.query(
      `delete from folio_postings where folio_id in (
         select id from folios where reservation_id = any($1::uuid[]))`, [ids]);
    await client.query(
      `delete from folios where reservation_id = any($1::uuid[])`, [ids]);
    await client.query(
      `delete from room_assignments where reservation_id = any($1::uuid[])`, [ids]);
    await client.query(
      `delete from reservations where id = any($1::uuid[])`, [ids]);
  }
  await client.query(
    `delete from guests where full_name like $1`, [`%[${TAG}]`]);

  /* Its own restaurant service. `pos_order_lines_frozen` refuses to
     let a paid bill change and is right to; these are unpaid demo
     tables, and the guard is lifted for exactly these statements. */
  await client.query(
    "alter table pos_order_lines disable trigger pos_order_lines_frozen");
  await client.query(
    `delete from pos_order_lines where order_id in (
       select id from pos_orders where order_no like $1)`, [`${TAG}-%`]);
  await client.query(
    `delete from pos_orders where order_no like $1`, [`${TAG}-%`]);
  await client.query(
    "alter table pos_order_lines enable trigger pos_order_lines_frozen");

  await client.query("alter table guests enable trigger guests_no_delete");
  await client.query(
    "alter table folio_postings enable trigger folio_postings_append_only");
  await client.query("commit");
}

async function fill(
  client: pg.Client,
  made: Made,
  opts: { code: string; from: string; to: string; occupancy: number; seed: number },
) {
  const rand = seeded(opts.seed);

  const { rows: hotel } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [opts.code]);
  if (!hotel[0]) return;
  const hotelId = hotel[0].id;

  /* ── DEMO PRICES FOR THE DEMO PROPERTIES ────────────────────────
     Agra and Pune arrive unpriced, and correctly so: migration 032
     stripped every shipped rate, and the suite asserts that a newly
     provisioned property has none. `agreed_rate` is NOT NULL, so
     without a rate there can be no booking, and without bookings the
     group dashboard has two empty properties.

     THE RULE IS THAT THE PRODUCT SHIPS NO PRICES, not that a demo has
     none. `load-demo` already writes rates for Akkalkot from its
     fixtures; this does the same for the two test properties. It lives
     in a script nobody deploys, and it must never move into a
     migration — 017 had to go back and delete seven placeholder
     properties that a seed migration shipped.

     Akkalkot is left alone: it has real rates from the export. */
  if (opts.code !== "5EL") {
    await client.query(
      `update room_types set base_rate = case code
         when 'STD' then 2400 when 'DLX' then 3200
         when 'EXE' then 4200 when 'STE' then 6500
         else base_rate end
       where hotel_id = $1 and base_rate is null`, [hotelId]);
  }

  const { rows: rooms } = await client.query<{
    id: string; number: string; type_id: string; rate: string | null;
  }>(
    `select r.id, r.number, rt.id as type_id, rt.base_rate::text as rate
       from rooms r join room_types rt on rt.id = r.room_type_id
      where r.hotel_id = $1 and r.is_active
      order by r.number`, [hotelId]);
  if (rooms.length === 0) return;

  /* COMPANIES ARE GROUP-LEVEL. No hotel_id on the table — a booking
     source is the same Agoda at every property, which is what makes the
     Booking sources screen comparable across them. */
  const { rows: companies } = await client.query<{ id: string; name: string }>(
    `select id, name from companies`);
  const companyByName = new Map(companies.map((c) => [c.name, c.id]));

  const start = new Date(opts.from + "T00:00:00Z");
  const end = new Date(opts.to + "T00:00:00Z");
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);

  let n = 0;
  for (let d = 0; d < days; d += 1) {
    const date = new Date(start.getTime() + d * 86400000);
    const iso = date.toISOString().slice(0, 10);

    /* AUGUST AT AKKALKOT IS NOT THIS SCRIPT'S. The calibrated window is
       1–25 August, and a stay starting on the 30th of July for four
       nights would reach into it. So July stops short by a week and
       August is skipped entirely at 5EL. */
    if (opts.code === "5EL" && iso >= "2026-07-25") continue;

    const arrivals = Math.round(rooms.length * opts.occupancy * (0.5 + rand()));
    for (let a = 0; a < arrivals; a += 1) {
      const room = rooms[Math.floor(rand() * rooms.length)]!;
      const nights = 1 + Math.floor(rand() * 3);
      const out = new Date(date.getTime() + nights * 86400000);
      const outIso = out.toISOString().slice(0, 10);
      if (opts.code === "5EL" && outIso > "2026-07-31") continue;

      /* Does this room already have somebody in it? `ra_no_double_booking`
         would refuse, and an exception here would roll back the whole
         load — so ask first rather than catching. */
      const { rows: busy } = await client.query<{ n: string }>(
        `select count(*)::text as n from room_assignments
          where room_id = $1 and released_at is null
            and daterange(from_date, to_date, '[)')
             && daterange($2::date, $3::date, '[)')`,
        [room.id, iso, outIso]);
      if (Number(busy[0]!.n) > 0) continue;

      n += 1;
      const name = `${FIRST[Math.floor(rand() * FIRST.length)]} `
        + `${LAST[Math.floor(rand() * LAST.length)]} [${TAG}]`;

      /*  carries no city and no hotel — a guest is a PERSON,
         group-wide, which is why 041's comment says the same passport
         can be presented at another property. Columns queried rather
         than assumed, after assuming twice. */
      const { rows: guest } = await client.query<{ id: string }>(
        `insert into guests (full_name, phone, nationality)
         values ($1, $2, 'IN') returning id`,
        [name, `+9198${String(10000000 + Math.floor(rand() * 89999999))}`]);
      made.guests += 1;

      const source = SOURCES[Math.floor(rand() * SOURCES.length)]!;
      /* The rack rate, moved a little either way — a demo where every
         booking is the same price makes ADR meaningless, which is one
         of the numbers this data exists to make readable. NULL stays
         NULL: an unpriced room type is not given a price here. */
      const rack = room.rate === null ? null : Number(room.rate);
      const rate = rack === null ? null
        : round2(rack * (0.82 + rand() * 0.36));

      const { rows: res } = await client.query<{ id: string }>(
        `insert into reservations
           (hotel_id, reference, guest_id, company_id, room_type_id,
            check_in, check_out, adults, children, occupancy,
            agreed_rate, status, source, meal_plan)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'checked_out',$12,'EP')
         returning id`,
        [hotelId, `${TAG}-${opts.code}-${String(n).padStart(4, "0")}`,
         guest[0]!.id, companyByName.get(source) ?? null, room.type_id,
         iso, outIso, 1 + Math.floor(rand() * 2), 0,
         1 + Math.floor(rand() * 2), rate, source]);
      made.stays += 1;

      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date,
            reason, released_at)
         values ($1,$2,$3,$4,$5,'arrival',now())`,
        [hotelId, res[0]!.id, room.id, iso, outIso]);

      const { rows: folio } = await client.query<{ id: string }>(
        `insert into folios (hotel_id, reservation_id, status, closed_at)
         values ($1,$2,'closed',now()) returning id`,
        [hotelId, res[0]!.id]);

      /* One night's room charge per night, then a settlement. Nothing
         is invented when the rate is NULL — an unpriced stay posts
         nothing, exactly as the night audit would do. */
      if (rate !== null) {
        let owed = 0;
        for (let k = 0; k < nights; k += 1) {
          const night = new Date(date.getTime() + k * 86400000)
            .toISOString().slice(0, 10);
          const tax = round2(rate * 0.05);
          await client.query(
            `insert into folio_postings
               (hotel_id, folio_id, business_date, category, description,
                amount, tax_rate, tax_amount)
             values ($1,$2,$3,'room','Room charge',$4,5,$5)`,
            [hotelId, folio[0]!.id, night, rate, tax]);
          owed += rate + tax;
          made.postings += 1;
        }

        const method = ["cash", "card", "upi"][Math.floor(rand() * 3)]!;
        const { rows: pay } = await client.query<{ id: string }>(
          `insert into folio_postings
             (hotel_id, folio_id, business_date, category, description,
              amount, tax_rate, tax_amount)
           values ($1,$2,$3,'payment',$4,$5,0,0) returning id::text`,
          [hotelId, folio[0]!.id, outIso,
           method === "cash" ? "Cash" : method === "card" ? "Card" : "UPI",
           round2(-owed)]);
        await client.query(
          `insert into payments (hotel_id, posting_id, method, amount)
           values ($1,$2::bigint,$3,$4)`,
          [hotelId, pay[0]!.id, method, round2(owed)]);
        made.postings += 1;
      }
    }
  }
}


/* ══════════════════════════════════════════════════════════════════
   A SERVICE IN THE RESTAURANT

   The kitchen screen shows lines whose `kot_status` is sent, preparing
   or ready, on an OPEN order. The demo had five orders — all of them
   left over from the test suite — and every single line was `pending`,
   because nothing had ever fired a KOT.

   So the pass was empty, and an empty pass looks exactly like a broken
   pass. It is the screen a chef stands in front of all evening, and it
   demonstrated nothing.

   THE THREE STATES ARE ALL REPRESENTED, because that is what the board
   is for: ordered, on the fire, at the pass. A demo showing one column
   filled and two empty teaches the wrong thing about the screen.

   One table is left with nothing fired — a waiter still taking the
   order — because that is the state that explains why "Send to the
   kitchen" exists.
   ══════════════════════════════════════════════════════════════════ */
async function fillRestaurant(client: pg.Client) {
  const rand = seeded(9001);

  const { rows: hotel } = await client.query<{ id: string; bd: string }>(
    `select id, business_date::text as bd from hotels where code = '5EL'`);
  if (!hotel[0]) return { orders: 0, onThePass: 0 };
  const hotelId = hotel[0].id;

  const { rows: outlet } = await client.query<{ id: string }>(
    `select id from pos_outlets where hotel_id = $1 and code = 'REST'`,
    [hotelId]);
  if (!outlet[0]) return { orders: 0, onThePass: 0 };

  const { rows: staff } = await client.query<{ id: string }>(
    `select s.id from staff s join staff_hotels sh on sh.staff_id = s.id
      where sh.hotel_id = $1 and s.is_active limit 1`, [hotelId]);
  if (!staff[0]) return { orders: 0, onThePass: 0 };

  const { rows: items } = await client.query<{
    id: string; name: string; price: string; tax: string;
  }>(
    `select id, name, price::text, tax_rate::text as tax
       from pos_menu_items where hotel_id = $1 and is_active
      order by name`, [hotelId]);
  if (items.length === 0) return { orders: 0, onThePass: 0 };

  const { rows: tables } = await client.query<{ label: string }>(
    `select t.label from pos_tables t
       join pos_sections sec on sec.id = t.section_id
      where sec.outlet_id = $1 order by t.label limit 12`, [outlet[0].id]);

  /* label, how many lines, and what the kitchen has done with them. */
  const PLAN: [string, number, "pending" | "sent" | "preparing" | "ready"][] = [
    ["AC1", 4, "ready"],
    ["AC2", 3, "preparing"],
    ["AC4", 5, "sent"],
    ["AC5", 2, "sent"],
    ["N2",  3, "preparing"],
    ["B1",  2, "pending"],
  ];

  let made = 0, onThePass = 0;

  for (const [fallbackLabel, count, state] of PLAN) {
    const label = tables.find((t) => t.label === fallbackLabel)?.label
      ?? fallbackLabel;
    made += 1;

    const { rows: order } = await client.query<{ id: string }>(
      `insert into pos_orders
         (hotel_id, outlet_id, order_no, table_ref, business_date,
          status, order_type, opened_by, covers)
       values ($1,$2,$3,$4,$5::date,'open','dine_in',$6,$7)
       returning id`,
      [hotelId, outlet[0].id, `${TAG}-${String(made).padStart(3, "0")}`,
       label, hotel[0].bd, staff[0].id, 2 + Math.floor(rand() * 4)]);

    for (let i = 0; i < count; i += 1) {
      const item = items[Math.floor(rand() * items.length)]!;
      const sent = state !== "pending";
      await client.query(
        `insert into pos_order_lines
           (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate,
            added_by, kot_status, kot_sent_at, kot_no)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [order[0]!.id, hotelId, item.id, item.name,
         1 + Math.floor(rand() * 2), item.price, item.tax, staff[0].id,
         state,
         /* Staggered, so the waiting time on the board is a range and
            not one number repeated — the chef reads that column to
            decide what to cook next. */
         /* Under 5 minutes is calm, 5-10 is warm, over 10 turns red —
            Kitchen.tsx line 165. Spread across all three so the board
            shows its colour coding, but weighted to calm: a demo where
            every dish is late teaches a chef to ignore the red. */
         sent ? new Date(Date.now() - Math.floor(rand() * 13 + 1) * 60000) : null,
         sent ? 1 : null]);
      if (sent) onThePass += 1;
    }
  }

  return { orders: made, onThePass };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
