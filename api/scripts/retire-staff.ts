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
import { readFileSync } from "node:fs";

/* ══════════════════════════════════════════════════════════════════
   RETIRE PEOPLE — take away the sign-in, keep the history

   End of beta. The testers go; the owner and whoever runs the group
   stay. Asked for on 9 September: "keep only you and the owner".

   ⚠ A STAFF ROW IS NOT SAFE TO DELETE, AND THAT IS BY DESIGN. Forty-
   eight columns across the schema point at `staff.id` — who posted a
   charge, who set a rate, who opened an outlet, who closed a work
   order, who changed a tax rule. The People screen says it out loud
   when you deactivate somebody:

       "Their name stays on everything they did — the audit log
        would be unreadable without it."

   So this does the thing that actually matters and does not pretend
   the rest is free:

     ALWAYS   the Firebase account is DELETED, so a token from it is
              refused before any policy is consulted
     ALWAYS   every staff_hotels grant is removed, so even reactivated
              they reach nothing
     ALWAYS   the row is deactivated, which is what every RLS policy
              in this system reads
     IF FREE  the row itself is deleted — only when nothing references
              it. A foreign key that says otherwise is history, and
              history wins.

   ⚠ IT REFUSES TO LEAVE THE GROUP WITH NO ADMINISTRATOR. `staff` has
   a `staff_keep_one_admin` trigger for the same reason, but a script
   that gets caught by a trigger halfway has already deleted somebody's
   Firebase account. Checked here, first, before anything is touched.

   ⚠ AND FIREBASE IS NOT IN THE TRANSACTION. Nothing can roll back a
   deleted account. So the database work is done first and committed;
   the accounts go afterwards, one at a time, each reported. A failure
   in the middle leaves people who cannot sign in — which is the
   intended end state — rather than people who can.

     npm run retire-staff -- --retire a@x.com,b@x.com          dry run
     npm run retire-staff -- --retire a@x.com,b@x.com --yes
   ══════════════════════════════════════════════════════════════════ */

/* ADMIN_DATABASE_URL first, for the reason set out at length in
   `reset-property.ts`: `DATABASE_URL` is the RLS-bound application role
   and would report an empty roster about a full one. */
const CONNECTION =
  process.env["ADMIN_DATABASE_URL"] ??
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

type Person = {
  id: string;
  email: string;
  full_name: string;
  uid: string | null;
  is_group_admin: boolean;
  is_active: boolean;
  grants: number;
};

async function main() {
  const list = (arg("retire") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const confirmed = process.argv.includes("--yes");

  if (list.length === 0) {
    console.error(
      "\n  Which accounts? Name them, so nothing is retired by pattern.\n"
      + "    npm run retire-staff -- --retire demo@x.com,test@x.com\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();

  try {
    const { rows: people } = await client.query<Person>(
      `select s.id::text, s.email::text, s.full_name,
              s.firebase_uid as uid, s.is_group_admin, s.is_active,
              (select count(*) from staff_hotels sh
                where sh.staff_id = s.id)::int as grants
         from staff s
        where lower(s.email::text) = any($1)`, [list]);

    const missing = list.filter(
      (e) => !people.some((p) => p.email.toLowerCase() === e));
    if (missing.length) {
      console.error(`\n  No such account: ${missing.join(", ")}`);
      console.error("  Nothing was changed. Check the spelling.\n");
      process.exit(1);
    }

    /* ⚠ BEFORE ANYTHING. A group with no administrator cannot add one:
       minting one needs the provisioning key AND an existing admin to
       ask. Being locked out of your own system at the end of a beta is
       a bad afternoon. */
    const { rows: admins } = await client.query<{ n: string }>(
      "select count(*)::text as n from staff where is_group_admin and is_active");
    /* ⚠ ACTIVE ADMINS BEING LOST, NOT ALL ADMINS ON THE LIST. The first
       version counted `is_group_admin` alone and subtracted it from a
       count of ACTIVE ones — so retiring an administrator who was
       already switched off, and therefore contributing nothing, looked
       like losing a live one.

       Found on the real data: Akkalkot has one active administrator
       and a seed placeholder called "REPLACE — your name" that is a
       group admin and inactive. Retiring the placeholder computed
       1 - 1 = 0 and refused, protecting nothing from nothing. */
    const losing = people.filter((p) => p.is_group_admin && p.is_active).length;
    if (Number(admins[0]!.n) - losing < 1) {
      console.error(
        `\n  That would leave the group with no administrator.\n`
        + `  ${admins[0]!.n} active today, ${losing} on this list.\n`
        + "  Nothing was changed.\n");
      process.exit(1);
    }

    console.log("");
    for (const p of people) {
      console.log(
        `  ${p.full_name.padEnd(24)} ${p.email.padEnd(34)} `
        + `${p.uid ? "has a login" : "no login"}, ${p.grants} propert`
        + `${p.grants === 1 ? "y" : "ies"}`);
    }

    if (!confirmed) {
      console.log(
        "\n  Dry run. Nothing was changed.\n"
        + "  Their Firebase accounts would be DELETED and their property\n"
        + "  access removed. The staff row is deleted only where nothing\n"
        + "  references it; otherwise it is deactivated and its name stays\n"
        + "  on the work it did.\n\n  Add --yes to do it.\n");
      return;
    }

    /* ── The database half, in one transaction ──────────────────── */
    const ids = people.map((p) => p.id);
    const deleted: string[] = [];
    const kept: string[] = [];

    await client.query("begin");
    await client.query("delete from staff_hotels where staff_id = any($1)", [ids]);
    await client.query(
      `update staff set is_active = false, firebase_uid = null
        where id = any($1)`, [ids]);
    await client.query("commit");

    /* ⚠ ONE SAVEPOINT EACH. A foreign key violation aborts the whole
       transaction in Postgres, so deleting six people in one block
       means the first one that is referenced takes the other five with
       it — and they would be reported as kept when nothing was even
       attempted. */
    for (const p of people) {
      await client.query("begin");
      try {
        await client.query("delete from staff where id = $1", [p.id]);
        await client.query("commit");
        deleted.push(p.email);
      } catch {
        await client.query("rollback");
        kept.push(p.email);
      }
    }

    /* ── The Firebase half, outside any transaction ─────────────── */
    const withLogin = people.filter((p) => p.uid);
    let gone = 0;
    if (withLogin.length) {
      const raw = process.env["FIREBASE_SERVICE_ACCOUNT"]
        ?? serviceAccountFromEnvFile();
      if (!raw) {
        console.log(
          "\n  ⚠ NO SERVICE ACCOUNT, so the Firebase logins are still there.\n"
          + "  They reach nothing — no property grant, and the staff row is\n"
          + "  inactive — but the accounts exist. Delete them in the console,\n"
          + "  or set FIREBASE_SERVICE_ACCOUNT and run this again.\n");
      } else {
        const { cert, initializeApp } = await import("firebase-admin/app");
        const { getAuth } = await import("firebase-admin/auth");
        const auth = getAuth(initializeApp({ credential: cert(JSON.parse(raw)) }));
        for (const p of withLogin) {
          try {
            await auth.deleteUser(p.uid!);
            gone += 1;
          } catch (e) {
            console.log(
              `  ⚠ ${p.email}: ${(e as { message?: string }).message ?? e}`);
          }
        }
      }
    }

    console.log("");
    console.log(`  Firebase accounts deleted   ${gone} of ${withLogin.length}`);
    console.log(`  Property access removed     ${people.length}`);
    if (deleted.length) {
      console.log(`  Rows deleted                ${deleted.join(", ")}`);
    }
    if (kept.length) {
      console.log(
        `  Rows KEPT, deactivated      ${kept.join(", ")}\n`
        + "    Something in the system points at them — a rate they set, an\n"
        + "    outlet they opened, a charge they posted. The name stays so\n"
        + "    that record still reads. They cannot sign in.");
    }
    console.log("");
  } finally {
    await client.end();
  }
}

/** The API reads its own `.env`; so does this, rather than making the
    operator export a JSON blob into their shell by hand. */
function serviceAccountFromEnvFile(): string | null {
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const m = env.match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m);
    return m ? m[1]!.replace(/^['"]|['"]$/g, "") : null;
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("\n ", e instanceof Error ? e.message : e, "\n");
    process.exit(1);
  });
}
