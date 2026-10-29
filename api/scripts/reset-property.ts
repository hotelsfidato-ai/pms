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
import { photoStoreSet, removeListed } from "../src/routes/idPhotos.ts";

/* ══════════════════════════════════════════════════════════════════
   CLEAR A PROPERTY AND BRING IT TO TODAY

   The demo is a faithful copy of August 2026 at Akkalkot, and that is
   what made it useful and what now makes it wrong: the property's
   business date is pinned ten days in the past, so a guest arriving
   today reads as a future booking and CANNOT be checked in. The
   refusal is correct and the data is the problem.

   This removes every TRANSACTION and keeps every SETTING:

     GOES     bookings, guests, folios, postings, payments, refunds, invoices,
              Form C filings, room assignments, blocks, work orders,
              restaurant orders, banquet events, night audit runs,
              cashier shifts, spa appointments, laundry dockets, the
              guests' own links, what is owed to suppliers, and the
              Store's movements and counts
     STAYS    the property, its rooms and room types, rates, staff,
              outlets, the menu, tables, sections, modules, the hours
              and charges on the front desk, and the Store's items,
              levels, places and suppliers

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

   THE CLEARING ITSELF IS IN THE DATABASE (D27-342, 28 October), in the
   migration "owner full reset": owner_reset.counts() is the dry run and
   owner_reset.clear() the clear, its list in owner_reset.steps(). The
   owner's "Clear this hotel and start today" button on Admin → Properties
   calls the very same two, so the button and this script cannot differ.
   api/test/resetOrder.test.ts checks the list against the schema's keys.
   Like the button, it refuses a test hotel (it has its own Reset) and a
   hotel with a guest checked in, saying who.

   AND, LIKE THE BUTTON, THE GUESTS' ID PHOTOS GO FROM GOOGLE DRIVE
   (D27-379), after the clear has committed, through the API's own
   idPhotos.ts and the photo store's settings in api/.env - which this
   script reads when run as the API's user (`sudo -u fidato`, as below).
   Run without them (as postgres, which cannot read api/.env) on a hotel
   with ID photos, it REFUSES before anything is written: a clear that
   would leave IDs in Drive is not done. One Drive would not delete is
   said, by count, and stays listed for the next try.
   ══════════════════════════════════════════════════════════════════ */

/* ⚠ WHICH CONNECTION, AND WHY IT IS NOT DATABASE_URL.

   `DATABASE_URL` is `pms_app`, the role every RLS policy is written
   against. It may not even call the clearing functions, so this script
   would fail on the first one having reported nothing to remove.

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

/** The dry run, as owner_reset.counts() gives it (the button shows the same). */
interface DryRun {
  code: string;
  name: string;
  businessDate: string;
  /** Rows that would go, by table - only tables with something in them. */
  tables: Record<string, number>;
  /** Guests left with no stay at any other hotel, who go too. */
  guests: number;
  /** ID photo files in Google Drive the clear has Drive delete. */
  idPhotos: number;
  /** Why a clear would be refused, in a sentence; null when it would not. */
  refusal: string | null;
}

async function main() {
  const code = (process.argv[2] ?? "").toUpperCase();
  const confirmed = process.argv.includes("--yes");
  const fresh = process.argv.includes("--fresh-start");

  if (!code) {
    console.error("\n  Which property?   npm run reset -- 5EL --yes\n");
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();
  const say = (s: string) => console.log(`  ${s}`);

  try {
    /* ⚠ AND PROVE IT CAN ACT BEFORE IT TRIES. Connecting is not the
       same as being able to act: an under-privileged role connects
       fine and is then refused. This is the check `link-staff.ts` grew
       after printing an empty list against six real staff members. */
    const { rows: who } = await client.query<{
      me: string; superuser: boolean; owns: string;
    }>(
      /* ⚠ TWO WAYS TO BE ABLE TO ACT, and the first version knew one.
         It asked only "do you own tables", which is true of the schema
         owner and FALSE of a superuser — `postgres` owns nothing here,
         the migration role owns them all, and a superuser can do
         anything regardless. So the guard refused the most capable
         connection there is. Caught by running it. */
      `select current_user as me,
              coalesce((select usesuper from pg_user
                         where usename = current_user), false) as superuser,
              (select count(*)::text from pg_tables
                where schemaname = 'public' and tableowner = current_user)
                as owns`);
    if (!who[0]!.superuser && who[0]!.owns === "0") {
      console.error(
        `\n  Connected as "${who[0]!.me}" — not a superuser, and owning no\n`
        + "  table here. That role may not clear a property.\n\n"
        + "  On the server, as the schema owner:\n"
        + "    cd /opt/fidato/api && sudo -u fidato env HOME=/tmp \\\n"
        + "      npm run reset -- <CODE> --yes\n\n"
        + "  Nothing was changed.\n");
      process.exit(1);
    }

    const { rows: [dry] } = await client.query<{ d: DryRun }>(
      "select owner_reset.counts($1, $2) as d", [code, fresh]);
    const d = dry!.d;

    console.log();
    say(`${d.name} (${d.code})`);
    say(`business date ${d.businessDate}`);
    const lines = Object.entries(d.tables)
      .map(([table, n]) => `${n} ${table.replaceAll("_", " ")}`);
    say(lines.length ? `goes: ${lines.join(" · ")}` : "nothing to remove");
    say(`and ${d.guests} guests with no stay at another property`);
    say(`and ${d.idPhotos} ID photos in Google Drive, deleted after the clear`);
    if (fresh) say("(a fresh start: the equipment register itself and the audit trail stay)");
    console.log();

    if (d.refusal) {
      console.error(`  ${d.refusal}\n  Nothing was changed.\n`);
      process.exitCode = 1;
      return;
    }
    if (d.idPhotos > 0 && !photoStoreSet()) {
      console.error(
        "  This run cannot reach the ID photo store (ID_PHOTO_N8N_URL and\n"
        + "  ID_PHOTO_N8N_SECRET, in api/.env), so the ID photos would stay in\n"
        + "  Google Drive. Run it as the API's user, which reads api/.env:\n"
        + "    cd /opt/fidato/api && sudo -u fidato env HOME=/tmp \\\n"
        + `      npm run reset -- ${code}${fresh ? " --fresh-start" : ""} --yes\n`
        + "  Nothing was changed.\n");
      process.exitCode = 1;
      return;
    }
    if (!confirmed) {
      say("Nothing removed. This deletes every booking, folio, invoice,");
      say("order and stock movement at this property and cannot be undone");
      say("for real data.");
      say(`Run it again with --yes:   npm run reset -- ${code}${fresh ? " --fresh-start" : ""} --yes`);
      console.log();
      return;
    }

    /* One transaction: all of it, or none of it. */
    await client.query("begin");
    const { rows: [done] } = await client.query<{
      r: { removed: number; rooms: number; businessDate: string;
           idPhotos: { hotelCode: string; driveFileId: string }[] };
    }>("select owner_reset.clear($1, $2, null, null) as r", [code, fresh]);
    await client.query("commit");
    /* Committed: now Drive, and only counts are printed. */
    const drive = await removeListed(client, done!.r.idPhotos);

    say(`${done!.r.removed} rows removed`);
    say(`${done!.r.rooms} rooms kept, all vacant and clean`);
    say(`business date is now ${done!.r.businessDate}`);
    say(`${drive.deleted} ID photos deleted from Google Drive`);
    if (drive.notDeleted) {
      console.error(`  ${drive.notDeleted} ID photos are STILL in Google Drive: Drive did not delete them.\n`
        + "  They stay listed (owner_reset.id_photos_in_drive) and the API asks Drive\n"
        + "  again every hour until it deletes them (D27-380).");
      process.exitCode = 1;
    }
    console.log();
    say("The property is empty and on today. Rooms, rates, staff, the");
    say("menu and the front desk's hours are untouched.");
    console.log();
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error(`\n  reset failed: ${(error as Error).message}\n  Nothing was changed.\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
