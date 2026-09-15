import { Client } from "pg";
import { env } from "../src/env.ts";

/* ══════════════════════════════════════════════════════════════════
   LINK A FIREBASE ACCOUNT TO A STAFF ROW

   This is the join nobody thinks about until the first real sign-in
   fails. Firebase authenticates a PERSON; Postgres authorises a
   STAFF MEMBER; `staff.firebase_uid` is the only thing connecting
   them, and `app.current_user_id()` resolves through it.

   Without the link a genuine, correctly-signed token arrives, passes
   verification, and resolves to nobody. Every RLS policy then returns
   the empty set, so the user sees a working application with no
   properties, no bookings and no error — which reads as "the database
   is empty", not as "you are not linked".

   The uids in a development database are `dev-owner`, `dev-agra` and
   `dev-pune`. Those are not Firebase uids and will never match one.

   USAGE

     npm run link-staff -- --email owner@fidato.in --uid <firebase-uid>
     npm run link-staff -- --list

   The uid comes from the Firebase console (Authentication → Users →
   the "User UID" column), or from `firebase auth:export`.
   ══════════════════════════════════════════════════════════════════ */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/* A Firebase uid is 28 characters of base58-ish text. Checked because
   the commonest mistake here is pasting the EMAIL or the project id
   into the uid slot, and a wrong-but-plausible uid links the account
   to nobody in a way that looks exactly like success. */
const LOOKS_LIKE_UID = /^[A-Za-z0-9]{20,64}$/;

async function main() {
  /* ADMIN_DATABASE_URL first. `env.databaseUrl` is the application role
     and `staff` is behind RLS, so with no session set this reads zero
     rows — `--list` printed an empty list against six staff members,
     and a link would silently update nothing. Same bug the preflight
     had; both now prefer a connection that can see. */
  const url = process.env["ADMIN_DATABASE_URL"] ?? env.databaseUrl;
  const client = new Client({ connectionString: url });
  await client.connect();

  const { rows: vis } = await client.query<{ n: string }>(
    "select count(*)::text as n from staff",
  );
  if (vis[0]!.n === "0") {
    console.error(
      "\n  No staff are readable on this connection.\n"
      + "  `staff` is behind row level security and this role has no session\n"
      + "  set, so it sees nothing — a link would update zero rows and say\n"
      + "  it worked. Set ADMIN_DATABASE_URL to a role that owns the schema.\n",
    );
    process.exitCode = 1;
    await client.end();
    return;
  }

  try {
    if (process.argv.includes("--list")) {
      const { rows } = await client.query(
        `select full_name, email, firebase_uid,
                (select count(*) from staff_hotels sh where sh.staff_id = s.id)::int
                  as properties
           from staff s where is_active order by full_name`,
      );
      console.log("\n  Staff, and whether a Firebase account can reach them\n");
      for (const r of rows) {
        const uid = r["firebase_uid"] as string | null;
        const state = uid === null
          ? "NOT LINKED — cannot sign in"
          : /^dev-/.test(uid)
            ? `${uid}  (development placeholder, not a Firebase uid)`
            : uid;
        console.log(`  ${String(r["full_name"]).padEnd(22)} ${String(r["email"]).padEnd(28)} ${state}`);
        console.log(`  ${"".padEnd(22)} ${String(r["properties"]).padEnd(28)} propert${r["properties"] === 1 ? "y" : "ies"}`);
      }
      console.log("");
      return;
    }

    const email = arg("email");
    const uid = arg("uid");

    if (!email || !uid) {
      console.error(
        "\n  Both are needed:\n"
        + "    npm run link-staff -- --email owner@fidato.in --uid <firebase-uid>\n"
        + "    npm run link-staff -- --list\n",
      );
      process.exitCode = 1;
      return;
    }

    if (!LOOKS_LIKE_UID.test(uid)) {
      console.error(
        `\n  "${uid}" does not look like a Firebase uid.\n`
        + "  A uid is a long run of letters and digits with no @ and no dashes —\n"
        + "  find it in the Firebase console under Authentication → Users,\n"
        + "  in the User UID column. Refusing rather than linking to nobody.\n",
      );
      process.exitCode = 1;
      return;
    }

    /* Somebody else already holds this uid. Two staff rows on one
       Firebase account means the person's identity depends on which
       row a query happens to reach — so the unique index refuses it,
       and this refuses it first with a sentence. */
    const { rows: taken } = await client.query<{ full_name: string }>(
      "select full_name from staff where firebase_uid = $1 and email <> $2",
      [uid, email],
    );
    if (taken[0]) {
      console.error(
        `\n  That uid is already linked to ${taken[0].full_name}.\n`
        + "  One Firebase account is one person. Unlink them first if this\n"
        + "  is genuinely the same person under a new email.\n",
      );
      process.exitCode = 1;
      return;
    }

    const { rows } = await client.query<{
      full_name: string; was: string | null;
    }>(
      `update staff set firebase_uid = $2
        where email = $1 and is_active
      returning full_name,
                (select firebase_uid from staff where email = $1) as was`,
      [email, uid],
    );

    if (!rows[0]) {
      console.error(
        `\n  No active staff member has the email ${email}.\n`
        + "  Add them first — the person must exist here before a Firebase\n"
        + "  account can be pointed at them. `--list` shows who does exist.\n",
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\n  ${rows[0].full_name} → ${uid}`);
    console.log("  They can now sign in with that Firebase account.\n");
  } finally {
    await client.end();
  }
}

void main();
