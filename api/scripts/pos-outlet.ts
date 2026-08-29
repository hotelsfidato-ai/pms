import { closePool } from "../src/db.ts";
import { hashKey, issueKey } from "../src/routes/pos.ts";

/* ══════════════════════════════════════════════════════════════════
   POS OUTLET PROVISIONING

     npm run pos:outlet -- --hotel 5EL --code SATTVA --name "Sattva Restaurant"
     npm run pos:outlet -- --hotel 5EL --code SATTVA --rotate
     npm run pos:outlet -- --list

   Creating an outlet does three things that have to happen together:

     1. a SERVICE ACCOUNT in `staff`, holding the `pos` role at that
        one property, so RLS scopes the outlet the way it scopes a
        clerk and the audit log names who posted
     2. the outlet row
     3. an API key — PRINTED ONCE, stored only as a sha256 digest

   THE KEY IS NOT RECOVERABLE. That is the point: a database dump does
   not hand anyone the ability to post charges to guest folios. If it
   is lost, rotate — which issues a new one and invalidates the old.

   Run as the SUPERUSER connection, not pms_app: creating staff and
   granting property access is provisioning, not something the running
   application may do to itself.
   ══════════════════════════════════════════════════════════════════ */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const say = (s: string) => process.stdout.write(`  ${s}\n`);

async function main(): Promise<void> {
  if (has("list")) return list();

  const hotelCode = flag("hotel")?.toUpperCase();
  const code = flag("code")?.toUpperCase();

  if (!hotelCode || !code) {
    process.stdout.write(
      "\n  Usage:\n" +
        "    --hotel 5EL --code SATTVA --name \"Sattva Restaurant\" [--category food]\n" +
        "    --hotel 5EL --code SATTVA --rotate\n" +
        "    --list\n\n",
    );
    process.exitCode = 1;
    return;
  }

  const admin = new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

  try {
    const hotel = await admin.query<{ id: string; name: string }>(
      "select id, name from hotels where code = $1",
      [hotelCode],
    );
    if (!hotel.rows[0]) {
      say(`No property with code ${hotelCode}.`);
      process.exitCode = 1;
      return;
    }
    const hotelId = hotel.rows[0].id;

    const existing = await admin.query<{ id: string; name: string }>(
      "select id, name from pos_outlets where hotel_id = $1 and code = $2",
      [hotelId, code],
    );

    /* ── Rotate ──────────────────────────────────────────────────── */
    if (has("rotate")) {
      if (!existing.rows[0]) {
        say(`No outlet ${code} at ${hotelCode} to rotate.`);
        process.exitCode = 1;
        return;
      }
      const key = issueKey();
      await admin.query(
        "update pos_outlets set api_key_hash = $1 where id = $2",
        [hashKey(key), existing.rows[0].id],
      );
      printKey(hotelCode, code, key, "rotated — the previous key stopped working");
      return;
    }

    if (existing.rows[0]) {
      say(`${code} already exists at ${hotelCode}. Use --rotate for a new key.`);
      process.exitCode = 1;
      return;
    }

    /* ── The service account ─────────────────────────────────────── */
    const name = flag("name") ?? `${code} outlet`;
    const category = flag("category") ?? "food";
    const email = `pos+${hotelCode.toLowerCase()}-${code.toLowerCase()}@fidatohotels.com`;

    const staff = await admin.query<{ id: string }>(
      `insert into staff (email, full_name, is_group_admin)
       values ($1, $2, false)
       on conflict (email) do update set full_name = excluded.full_name
       returning id`,
      [email, `${name} (POS)`],
    );
    const staffId = staff.rows[0]!.id;

    /* One property, `pos` role. A POS that could reach a second hotel
       would be a POS that could charge a guest at a hotel it is not
       in. RLS reads this row and nothing else. */
    await admin.query(
      `insert into staff_hotels (staff_id, hotel_id, role)
       values ($1, $2, 'pos')
       on conflict (staff_id, hotel_id) do update set role = 'pos'`,
      [staffId, hotelId],
    );

    const key = issueKey();
    await admin.query(
      `insert into pos_outlets (hotel_id, code, name, category, staff_id,
                                api_key_hash)
       values ($1,$2,$3,$4,$5,$6)`,
      [hotelId, code, name, category, staffId, hashKey(key)],
    );

    say("");
    say(`${name}`);
    say(`  property   ${hotel.rows[0].name} (${hotelCode})`);
    say(`  outlet     ${code}`);
    say(`  category   ${category}  — the revenue line its charges land on`);
    say(`  posts as   ${email}`);
    printKey(hotelCode, code, key, "new outlet");
  } finally {
    await admin.end();
    await closePool();
  }
}

function printKey(hotel: string, code: string, key: string, note: string): void {
  say("");
  say("  ╭──────────────────────────────────────────────────────────────╮");
  say("  │  API KEY — SHOWN ONCE. It is not stored and cannot be read   │");
  say("  │  back. Copy it now; if it is lost, rotate.                   │");
  say("  ╰──────────────────────────────────────────────────────────────╯");
  say("");
  say(`    ${key}`);
  say("");
  say(`    ${note}`);
  say("");
  say("  The POS sends it on every request:");
  say("");
  say(`    curl -H "x-pos-key: ${key.slice(0, 12)}…" \\`);
  say("         http://localhost:8787/api/pos/rooms");
  say("");
}

async function list(): Promise<void> {
  const admin = new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });
  try {
    const { rows } = await admin.query<{
      hotel: string; code: string; name: string; category: string;
      has_key: boolean; is_active: boolean; tickets: string;
    }>(
      `select h.code as hotel, o.code, o.name, o.category,
              (o.api_key_hash is not null) as has_key, o.is_active,
              (select count(*) from pos_tickets t
                where t.outlet_id = o.id)::text as tickets
         from pos_outlets o join hotels h on h.id = o.hotel_id
        order by h.code, o.code`,
    );

    say("");
    if (rows.length === 0) {
      say("No POS outlets configured.");
      say("");
      return;
    }
    for (const r of rows) {
      say(
        `${r.hotel}  ${r.code.padEnd(10)} ${r.name.padEnd(26)} ` +
          `${r.category.padEnd(10)} ${r.tickets.padStart(5)} bills  ` +
          `${r.has_key ? "key set" : "NO KEY — cannot post"}` +
          `${r.is_active ? "" : "  (inactive)"}`,
      );
    }
    say("");
  } finally {
    await admin.end();
    await closePool();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`\n  ${String(error)}\n\n`);
  process.exitCode = 1;
});
