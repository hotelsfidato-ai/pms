import { Client } from "pg";
import { fileURLToPath } from "node:url";

/* Load api/.env exactly as src/env.ts does — Node 22 reads it itself.

   ⚠ WITHOUT THIS THE PREFLIGHT LIES. Run bare, it saw no
   ALLOW_DEV_AUTH in the process environment and reported "dev auth is
   off" against a box whose .env sets it to 1. A check that passes
   because it cannot see the setting is worse than no check: it is a
   green tick over the exact hole it exists to find. */
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  /* No file. The environment may legitimately be set another way — a
     systemd unit, a container. The checks below read process.env
     either way. */
}

/* ══════════════════════════════════════════════════════════════════
   PREFLIGHT — what must be true before this serves a real hotel

   Rule 6, applied to a deployment. Every check below is something
   that, wrong, produces a system that STARTS and looks fine:

     · dev auth left on           anybody can be anybody, via a header
     · no service account         nobody can sign in at all
     · dev uids still present     a real token resolves to nobody, and
                                  the application shows an empty hotel
     · CORS still on localhost    the browser blocks every request and
                                  the screens sit empty with no error
     · demo data present          a real hotel with fictional bookings
     · REPLACE placeholders       a property called "REPLACE — city"

   None of these throws. All of them are found by a guest at the desk,
   which is the wrong place and the wrong time.

   Exit code 1 on any failure, so a launch script can stop.
   ══════════════════════════════════════════════════════════════════ */

type Check = { ok: boolean; label: string; detail?: string; fatal: boolean };
const checks: Check[] = [];

const pass = (label: string, detail?: string) =>
  checks.push({ ok: true, label, ...(detail ? { detail } : {}), fatal: false });
const fail = (label: string, detail: string, fatal = true) =>
  checks.push({ ok: false, label, detail, fatal });

async function main() {
  const e = process.env;
  const production = e["NODE_ENV"] === "production";

  /* ── Identity ──────────────────────────────────────────────────── */
  if (e["ALLOW_DEV_AUTH"] === "1") {
    fail("dev auth is OFF",
      "ALLOW_DEV_AUTH=1. The x-dev-staff-id header names the caller, so "
      + "anybody who can reach the API is anybody they choose. Remove it.");
  } else {
    pass("dev auth is off");
  }

  const sa = e["FIREBASE_SERVICE_ACCOUNT"];
  if (!sa) {
    fail("Firebase service account present",
      "FIREBASE_SERVICE_ACCOUNT is unset. Without it no token can be "
      + "verified and nobody signs in. Download it from the Firebase "
      + "console → Project settings → Service accounts → Generate new "
      + "private key.");
  } else {
    try {
      const parsed = JSON.parse(sa) as { project_id?: string; type?: string };
      if (parsed.type !== "service_account") {
        fail("service account is a service account",
          `type is "${parsed.type}". This is the wrong JSON file — the web `
          + "app config is not a service account.");
      } else if (parsed.project_id !== e["FIREBASE_PROJECT_ID"]
                 && e["FIREBASE_PROJECT_ID"]) {
        /* A service account from the WRONG project verifies nothing and
           says only "Firebase ID token has incorrect audience". */
        fail("service account matches the project",
          `the key is for ${parsed.project_id}, the app expects `
          + `${e["FIREBASE_PROJECT_ID"]}.`);
      } else {
        pass("Firebase service account present", parsed.project_id ?? "");
      }
    } catch {
      fail("service account is valid JSON",
        "FIREBASE_SERVICE_ACCOUNT does not parse. It must be the whole "
        + "JSON file, not a path to it.");
    }
  }

  /* ── The browser must be allowed to talk to this ───────────────── */
  /* A LIST now, because the frontend is no longer served off this box.
     The staff app, the admin console, the tills and the CRS are separate
     origins, and the app's origin is the one thing that must be right or
     every screen goes empty with no error a clerk can report. Check each
     entry, and name the offender rather than the whole string. */
  const origins = (e["CORS_ORIGIN"] ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);

  if (origins.length === 0) {
    fail("CORS origins set",
      "CORS_ORIGIN is unset. The API will refuse every browser request, "
      + "and the browser will report it as the server being unreachable.");
  } else {
    const local = origins.filter((o) => /localhost|127\.0\.0\.1/.test(o));
    const insecure = origins.filter((o) => o.startsWith("http://"));

    if (production && local.length > 0) {
      fail("CORS origins are not localhost",
        `CORS_ORIGIN contains ${local.join(", ")}. That is a development `
        + "address. Requests from the real site will be blocked by the "
        + "browser and the screens will go empty.");
    } else if (production && insecure.length > 0) {
      fail("CORS origins are https",
        `CORS_ORIGIN contains ${insecure.join(", ")}. Firebase will not `
        + "hand a token to an insecure origin.", false);
    } else {
      pass("CORS origins set", origins.join(", "));
    }
  }

  /* ── The database ──────────────────────────────────────────────── */
  /* ADMIN_DATABASE_URL first, and this is not a nicety.

     FOUND BY CHECKING MY OWN OUTPUT AGAINST THE DATABASE. Connected as
     `pms_app`, every query below runs under ROW LEVEL SECURITY with no
     session set, so `app.auth_hotel_ids()` returns the empty set and
     every table reads as empty. This preflight reported "no demo
     properties" and "no development uids" green against a database
     holding both — RLS turned each check green by handing it nothing.

     A check that passes because it cannot see is the precise thing this
     file exists to catch, and it shipped inside the file itself. The
     visibility assertion below makes it impossible to repeat: nothing
     visible is fatal, whether the cause is an empty database or a
     connection that cannot read it. */
  const url = e["ADMIN_DATABASE_URL"] ?? e["DATABASE_URL"];
  if (!url) {
    fail("database reachable", "DATABASE_URL is unset.");
  } else {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();

      const { rows: mig } = await client.query<{ n: string }>(
        "select count(*)::text as n from information_schema.tables "
        + "where table_schema = 'public'",
      );
      pass("database reachable", `${mig[0]!.n} tables`);

      /* Can this connection SEE anything? Everything below depends on
         it, and the answer being no is completely silent. */
      const { rows: vis } = await client.query<{ n: string }>(
        "select count(*)::text as n from hotels",
      );
      if (vis[0]!.n === "0") {
        fail("the database is visible to this connection",
          "no properties are readable. Either the database is empty, or "
          + "this connection is subject to row level security with no "
          + "session set — in which case every check below would pass on "
          + "an empty result. Set ADMIN_DATABASE_URL to a role that owns "
          + "the schema.");
        await client.end().catch(() => {});
        return report();
      }
      pass("the database is visible to this connection",
        `${vis[0]!.n} properties`);

      /* Dev placeholders. A real token never matches `dev-owner`, so the
         person signs in successfully and sees an empty hotel. */
      const { rows: dev } = await client.query<{ n: string; who: string }>(
        `select count(*)::text as n,
                coalesce(string_agg(full_name, ', '), '') as who
           from staff where firebase_uid like 'dev-%' and is_active`,
      );
      if (Number(dev[0]!.n) > 0) {
        fail("no development uids",
          `${dev[0]!.who} still carry dev- uids. A real Firebase token will `
          + "not match them, so they sign in and see an empty hotel. Use "
          + "`npm run link-staff` to point them at real accounts.");
      } else {
        pass("no development uids");
      }

      /* Anybody who can never sign in. Not fatal — a POS terminal
         account legitimately has no person behind it — but it should
         be a decision rather than a surprise. */
      const { rows: unlinked } = await client.query<{ who: string }>(
        `select coalesce(string_agg(full_name, ', '), '') as who
           from staff where firebase_uid is null and is_active`,
      );
      if (unlinked[0]!.who) {
        fail("every staff member can sign in",
          `not linked to any Firebase account: ${unlinked[0]!.who}`, false);
      } else {
        pass("every staff member can sign in");
      }

      /* The demo. Fictional bookings in a real hotel's reports. */
      const { rows: demo } = await client.query<{ n: string }>(
        "select count(*)::text as n from hotels where code in ('AGR','PUN')",
      );
      if (Number(demo[0]!.n) > 0) {
        fail("no demo properties",
          "AGR and/or PUN are present. Those are test properties and their "
          + "bookings reach group-level reports.");
      } else {
        pass("no demo properties");
      }

      /* Placeholders from migration 008. */
      const { rows: repl } = await client.query<{ n: string }>(
        `select count(*)::text as n from hotels
          where name like 'REPLACE%' or city like 'REPLACE%'`,
      );
      if (Number(repl[0]!.n) > 0) {
        fail("no REPLACE placeholders",
          `${repl[0]!.n} propert${repl[0]!.n === "1" ? "y" : "ies"} still `
          + "named REPLACE. These print on invoices.");
      } else {
        pass("no REPLACE placeholders");
      }

      /* The same migration seeds a bootstrap PERSON, and that check above
         only ever looked at properties. `REPLACE@fidato.in` sat in `staff`
         as an ACTIVE GROUP ADMIN — the widest role the system has — and
         nothing anywhere objected. It cannot sign in today, because no
         Firebase account carries that address; it becomes a real key the
         moment somebody creates one, and it is the sort of address a person
         creates by accident while testing.

         Found by reading the staff table after deleting the test
         properties, not by a gate. */
      const { rows: bootstrap } = await client.query<{ who: string }>(
        `select coalesce(string_agg(email, ', '), '') as who
           from staff
          where is_active and email like 'REPLACE%'`,
      );
      if (bootstrap[0]!.who) {
        fail("no bootstrap accounts",
          `${bootstrap[0]!.who} is still active. Migration 008 seeds it so `
          + "the first real person has something to sign in as. Give it your "
          + "own address or deactivate it — a group admin nobody owns is an "
          + "unlocked door.");
      } else {
        pass("no bootstrap accounts");
      }

      /* Rooms. A property with none sells nothing and divides by zero
         in every occupancy figure. A test hotel (test_of set) serves no
         real guest, so it is left out (D27-336). */
      const { rows: empty } = await client.query<{ who: string }>(
        `select coalesce(string_agg(h.code, ', '), '') as who
           from hotels h
          where h.is_active
            and h.test_of is null
            and not exists (select 1 from rooms r
                             where r.hotel_id = h.id and r.is_active)`,
      );
      if (empty[0]!.who) {
        fail("every property has rooms",
          `no rooms entered for: ${empty[0]!.who}. Occupancy divides by `
          + "available room-nights, and a property with none reports nothing.");
      } else {
        pass("every property has rooms");
      }

      /* RLS. The one that matters most, and the cheapest to check. */
      const { rows: rls } = await client.query<{ n: string; who: string }>(
        `select count(*)::text as n,
                coalesce(string_agg(tablename, ', '), '') as who
           from pg_tables t
          where schemaname = 'public'
            and not exists (
              select 1 from pg_class c
               join pg_namespace nsp on nsp.oid = c.relnamespace
               where c.relname = t.tablename and nsp.nspname = 'public'
                 and c.relrowsecurity)`,
      );
      if (Number(rls[0]!.n) > 0) {
        fail("row level security on every table",
          `without RLS: ${rls[0]!.who}. One property would read another's `
          + "guests.");
      } else {
        pass("row level security on every table");
      }
    } catch (err) {
      fail("database reachable",
        err instanceof Error ? err.message : String(err));
    } finally {
      await client.end().catch(() => {});
    }
  }

  return report();
}

/** Printed from two places: the early return when the database is
    invisible, and the end of a full run. */
function report() {
  const production = process.env["NODE_ENV"] === "production";
  const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", X = "\x1b[0m";
  console.log(`\n  PREFLIGHT — ${production ? "production" : process.env["NODE_ENV"] ?? "no NODE_ENV"}\n`);
  for (const c of checks) {
    const mark = c.ok ? `${G}✓${X}` : c.fatal ? `${R}✗${X}` : `${Y}!${X}`;
    console.log(`  ${mark} ${c.label}${c.detail && c.ok ? `  ${c.detail}` : ""}`);
    if (!c.ok) console.log(`      ${c.detail}`);
  }

  const fatal = checks.filter((c) => !c.ok && c.fatal).length;
  const warn = checks.filter((c) => !c.ok && !c.fatal).length;

  if (fatal > 0) {
    console.log(`\n${R}  ${fatal} blocking. NOT READY TO SERVE A REAL HOTEL.${X}\n`);
    process.exitCode = 1;
  } else if (warn > 0) {
    console.log(`\n${Y}  ${warn} worth a look, none blocking.${X}\n`);
  } else {
    console.log(`\n${G}  Ready.${X}\n`);
  }
}

void main();
