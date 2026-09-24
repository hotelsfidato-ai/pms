import pg from "pg";
/* ⚠ `api/.env` IS READ HERE, AND NOT BY IMPORTING `src/env.ts`.

   The obvious line is `import "../src/env.ts"` for its side effect,
   and it was written that way first. It cannot work:

     · `api/.env` is mode 600, owned by `fidato`
     · this script has to run as `postgres`, the only superuser, because
       `fidato` owns no table and cannot lift the append-only triggers
     · `env.ts` VALIDATES — it throws when DATABASE_URL is absent, which
       it is when the file cannot be read

   So importing it made the script unrunnable by the one account able
   to do the job, and the failure was a config error about a variable
   nobody had asked for. Loading the file directly and shrugging when
   it is not there is what a maintenance script actually needs: the
   connection string is passed on the command line in that case.

   Not a second copy of a rule — `env.ts` decides what the SERVER
   requires, and a script run by hand by a different user has different
   requirements. One line, and it says why. */
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  /* Unreadable or absent. Fine: the caller passes the connection. */
}

import { fileURLToPath } from "node:url";
import { databaseForScript } from "./scriptDatabase.ts";

/* ══════════════════════════════════════════════════════════════════
   CLEAR A PROPERTY AND BRING IT TO TODAY

   The demo is a faithful copy of August 2026 at Akkalkot, and that is
   what made it useful and what now makes it wrong: the property's
   business date is pinned ten days in the past, so a guest arriving
   today reads as a future booking and CANNOT be checked in. The
   refusal is correct and the data is the problem.

   This removes every TRANSACTION and keeps every SETTING:

     GOES     bookings, guests, folios, postings, payments, invoices,
              Form C filings, room assignments, blocks, work orders,
              restaurant orders, banquet events, night audit runs,
              cashier shifts, spa appointments, laundry dockets, the
              guests' own links
     STAYS    the property, its rooms and room types, rates, staff,
              outlets, the menu, tables, sections, modules, and the
              hours and charges on the front desk

   So what is left is the hotel as it really is, empty, on today's
   date — ready for the first real booking.

   THE BUSINESS DATE IS SET, NOT ROLLED. Ten night audits would each
   post a room charge for a night nobody stayed. There is nothing left
   to audit once the bookings are gone, so the date moves directly and
   the audit history goes with the rest.

   IRREVERSIBLE FOR THE DATA IT REMOVES. `npm run demo` puts the demo
   back — it drops and rebuilds Akkalkot from the fixtures — but
   anything REAL entered after this runs is gone for good. It refuses
   without --yes for that reason.

     npm run reset -- 5EL --yes
   ══════════════════════════════════════════════════════════════════ */

/* ⚠ WHICH CONNECTION, AND WHY IT IS NOT DATABASE_URL.

   `DATABASE_URL` is `pms_app`, the role every RLS policy is written
   against. With no session set it sees almost nothing, and it owns no
   tables — so this script would print "0 bookings · 0 guests" about a
   busy hotel and then fail on `alter table ... disable trigger` with a
   permission error, halfway through, having reported nothing to remove.

   `deploy/launch.sh` writes ADMIN_DATABASE_URL into `api/.env` for
   exactly this: the schema owner, over the unix socket, peer
   authenticated. `preflight.ts` and `link-staff.ts` both prefer it and
   both were changed to after being caught by the same trap — the
   preflight reported a healthy box as broken and link-staff listed an
   empty roster against six real people.

   The localhost default is DEVELOPMENT's Postgres. It is last on
   purpose: a production box has no such server, so a missing
   ADMIN_DATABASE_URL fails to connect rather than quietly doing
   something to the wrong database. */
const CONNECTION = databaseForScript("reset-property");

/* Order is the whole of this. Children before parents, every time —
   a teardown is a migration run backwards and has the same rules
   (defect 115). */
export const CLEAR: [table: string, how: string][] = [
  /* EVERY NAME HERE WAS READ OUT OF THE SCHEMA, not remembered. The
     first version invented `invoice_lines` and `notifications`; neither
     exists, and the run aborted a third of the way through with the
     guards still lifted. Defect 9's shape, and the reason this list is
     now checked against information_schema. */
  /* D22-44's VAT bills point at an order, a bill and its tax invoice, so
     they go before all three. Their series stays, as the GST one does. */
  ["vat_bills",         "hotel_id = $1"],
  ["pos_order_tenders", "order_id in (select id from pos_orders where hotel_id = $1)"],
  ["pos_order_lines",   "hotel_id = $1"],
  /* ⚠ ORDERS BEFORE TICKETS. `pos_orders.ticket_id` references
     `pos_tickets`, so the order is the CHILD — and this list had them
     the other way round, which is the one thing its own comment says
     never to do.

     It survived every local run because the development database has
     no tickets: the delete matched nothing and no key was violated. It
     failed on the first production run, a third of the way through,
     with 17 orders on the file. A teardown is only exercised by data
     that exists.

     Tickets still come before `folio_postings` and `folios`, which
     they reference in turn. */
  ["pos_orders",        "hotel_id = $1"],
  ["pos_tickets",       "hotel_id = $1"],
  ["pos_cash_movements", "hotel_id = $1"],
  ["pos_denominations", "day_end_id in (select id from pos_day_ends where hotel_id = $1)"],
  ["pos_day_ends",      "hotel_id = $1"],

  ["banquet_event_packages", "hotel_id = $1"],

  ["cashier_denominations", "shift_id in (select id from cashier_shifts where hotel_id = $1)"],
  ["cashier_movements", "hotel_id = $1"],
  ["cashier_shifts",    "hotel_id = $1"],

  /* ⚠ ADDED 21 SEPTEMBER: THREE SERVICES BUILT AFTER THIS LIST WAS WRITTEN.
     A treatment and a laundry bag each point at a stay AND at the line they
     put on its bill, and a guest's link points at the booking — so each goes
     before `folio_postings` and `reservations`, or the run stops at the first
     key they hold. Found by asking pg_constraint which tables point at a
     booking, a guest or a bill, before clearing the owner's laptop. Their
     children (docket lines, link codes) and a booking's inclusions go by
     ON DELETE CASCADE. `resetOrder.test.ts` checks this list against the
     schema's keys. */
  ["spa_appointments",  "hotel_id = $1"],
  ["laundry_dockets",   "hotel_id = $1"],
  ["guest_links",       "hotel_id = $1"],

  ["form_c_filings",    "hotel_id = $1"],
  ["invoices",          "hotel_id = $1"],
  ["payments",          "hotel_id = $1"],
  ["folio_postings",    "hotel_id = $1"],
  ["folios",            "hotel_id = $1"],

  /* A guest's papers go with the stay they were taken for. */
  ["guest_documents",   "guest_id in (select guest_id from reservations where hotel_id = $1)"],

  ["housekeeping_assignments", "hotel_id = $1"],
  ["room_assignments",  "hotel_id = $1"],
  ["room_status_log",   "hotel_id = $1"],
  /* A repair's costs point at the work order with no cascade — found by
     the completeness test the day it was written (21 September). */
  ["work_order_costs",  "hotel_id = $1"],
  ["work_orders",       "hotel_id = $1"],
  ["room_blocks",       "hotel_id = $1"],

  ["banquet_events",    "hotel_id = $1"],
  ["reservations",      "hotel_id = $1"],
  /* Groups have no hotel_id: they are cleared once no booking anywhere
     points at them, so clearing Akkalkot cannot take Pune's group. */
  ["reservation_groups", "not exists (select 1 from reservations r where r.group_id = reservation_groups.id)"],
  ["night_audit_runs",  "hotel_id = $1"],
];

/* Lifted for these statements only and put back immediately, the way
   017 and the demo loader do it. Every one of these guards is right
   about real data; clearing a property is an administrative act and
   nothing in api/src may perform it. */
const GUARDS: [table: string, trigger: string][] = [
  /* READ OUT OF pg_trigger, not remembered. The first list had four of
     these and the run died on the fifth — "tenders on a settled order
     cannot be removed" — a third of the way through, which is the
     worst place for a clearing script to stop. */
  ["folio_postings",    "folio_postings_append_only"],
  ["folio_postings",    "folio_postings_closed_date"],
  ["invoices",          "invoices_immutable"],
  ["vat_bills",         "vat_bills_immutable"],
  ["pos_order_lines",   "pos_order_lines_frozen"],
  ["pos_order_lines",   "pos_order_lines_void_cascade"],
  ["pos_order_tenders", "pos_order_tenders_no_delete_settled"],
  ["pos_orders",        "pos_orders_no_reopen"],
  ["pos_orders",        "pos_orders_clear_final"],
  ["reservations",      "reservations_void_releases"],
  ["room_assignments",  "ra_within_stay"],
  ["guests",            "guests_no_delete"],
  /* 21 September: a restaurant order's history goes by cascade with the
     order, and this trigger refuses every delete of it. */
  ["pos_line_events",   "pos_line_events_no_delete"],
];

async function main() {
  const code = (process.argv[2] ?? "").toUpperCase();
  const confirmed = process.argv.includes("--yes");

  if (!code) {
    console.error("\n  Which property?   npm run reset -- 5EL --yes\n");
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();
  const say = (s: string) => console.log(`  ${s}`);

  try {
    /* ⚠ AND PROVE IT CAN SEE BEFORE IT DELETES. Connecting is not the
       same as being able to act: an under-privileged role connects
       fine and then reads an empty world. This is the check
       `link-staff.ts` grew after printing an empty list against six
       real staff members. */
    const { rows: who } = await client.query<{
      me: string; superuser: boolean; owns: string;
    }>(
      /* ⚠ TWO WAYS TO BE ABLE TO ACT, and the first version knew one.
         It asked only "do you own tables", which is true of the schema
         owner on the server (`fidato`) and FALSE of a superuser —
         `postgres` owns nothing here, the migration role owns all 66,
         and a superuser can do anything regardless. So the guard
         refused the most capable connection there is. Caught by running
         it. */
      `select current_user as me,
              coalesce((select usesuper from pg_user
                         where usename = current_user), false) as superuser,
              (select count(*)::text from pg_tables
                where schemaname = 'public' and tableowner = current_user)
                as owns`);
    if (!who[0]!.superuser && who[0]!.owns === "0") {
      console.error(
        `\n  Connected as "${who[0]!.me}" — not a superuser, and owning no\n`
        + "  table here. That role cannot lift the append-only guards it\n"
        + "  has to lift,\n"
        + "  and row level security would hide most of what it is meant to\n"
        + "  remove — so it would report a quiet, wrong success.\n\n"
        + "  On the server, as the schema owner:\n"
        + "    cd /opt/fidato/api && sudo -u fidato env HOME=/tmp \\\n"
        + "      npm run reset -- <CODE> --yes\n\n"
        + "  Nothing was changed.\n");
      process.exit(1);
    }

    const { rows: hotel } = await client.query<{
      id: string; name: string; bd: string; tz: string;
    }>(
    `select id, name, business_date::text as bd, timezone as tz
         from hotels where code = $1`, [code]);
    if (!hotel[0]) {
      console.error(`\n  No property with code ${code}.\n`);
      process.exitCode = 1;
      return;
    }

    const { rows: counts } = await client.query<{
      stays: string; guests: string; postings: string; orders: string;
    }>(
      `select (select count(*) from reservations where hotel_id = $1)::text as stays,
              (select count(distinct guest_id) from reservations where hotel_id = $1)::text as guests,
              (select count(*) from folio_postings where hotel_id = $1)::text as postings,
              (select count(*) from pos_orders where hotel_id = $1)::text as orders`,
      [hotel[0].id]);

    console.log();
    say(`${hotel[0].name} (${code})`);
    say(`business date ${hotel[0].bd}`);
    say(`${counts[0]!.stays} bookings · ${counts[0]!.guests} guests`
        + ` · ${counts[0]!.postings} postings · ${counts[0]!.orders} orders`);
    console.log();

    if (!confirmed) {
      say("Nothing removed. This deletes every booking, folio, invoice and");
      say("order at this property and cannot be undone for real data.");
      say(`Run it again with --yes:   npm run reset -- ${code} --yes`);
      console.log();
      return;
    }

    await client.query("begin");
    for (const [table, trigger] of GUARDS) {
      await client.query(`alter table ${table} disable trigger ${trigger}`);
    }

    let removed = 0;
    for (const [table, where] of CLEAR) {
      /* reservation_groups is not hotel-scoped, so its clause takes no
         parameter. Passing one to a query with no placeholder is an
         error in node-postgres, not a no-op. */
      const r = where.includes("$1")
        ? await client.query(`delete from ${table} where ${where}`, [hotel[0].id])
        : await client.query(`delete from ${table} where ${where}`);
      removed += r.rowCount ?? 0;
    }

    /* Guests are group-wide and have no hotel_id — a guest is a PERSON,
       and the same passport can be presented at another property. Only
       the ones now belonging to no stay anywhere are removed, so
       clearing Akkalkot cannot take a guest Pune still has. */
    const orphaned = await client.query(
      `delete from guests g
        where not exists (select 1 from reservations r where r.guest_id = g.id)
          and not exists (select 1 from banquet_events b where b.guest_id = g.id)`);
    removed += orphaned.rowCount ?? 0;

    /* Every room comes back vacant and clean. A room left dirty by a
       departure that no longer exists is a room housekeeping is asked
       to clean for nobody. */
    await client.query(
      `update rooms set occupancy_status = 'vacant',
                        housekeeping_status = 'clean'
        where hotel_id = $1`, [hotel[0].id]);

    /* TODAY, in the property's own timezone. `current_date` on the
       server is the server's day, and a hotel in Akkalkot closes its
       own — the same distinction app.arrival_is_early makes. */
    await client.query(
      `update hotels
          set business_date = (now() at time zone timezone)::date
        where id = $1`, [hotel[0].id]);

    for (const [table, trigger] of GUARDS) {
      await client.query(`alter table ${table} enable trigger ${trigger}`);
    }
    await client.query("commit");

    const { rows: after } = await client.query<{ bd: string; rooms: string }>(
      `select business_date::text as bd,
              (select count(*) from rooms where hotel_id = $1)::text as rooms
         from hotels where id = $1`, [hotel[0].id]);

    say(`${removed} rows removed`);
    say(`${after[0]!.rooms} rooms kept, all vacant and clean`);
    say(`business date is now ${after[0]!.bd}`);
    console.log();
    say("The property is empty and on today. Rooms, rates, staff, the");
    say("menu and the front desk's hours are untouched.");
    console.log();
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error(`\n  reset failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
