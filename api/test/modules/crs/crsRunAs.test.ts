import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { runOnce } from "../../../src/modules/crs/index.ts";
import { dueHotels } from "../../../src/modules/crs/jobs.ts";
import { useFetchForTests } from "../../../src/modules/crs/firestore.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ACCOUNT THE CRS READER WORKS AS - deploy/crs-run-as.sql (D27-284 (3))

   The owner runs that file on the server, once per hotel, to let the CRS's
   bookings into the live PMS. Here it runs the same way - psql, -v hotel=,
   -f the file - against this run's scratch database, on a hotel made as
   live's AMR was (no room types until added, then connected on the card
   "Connection to the CRS" with its switch on and nobody to read as):

   1. Without it, the reader passes the hotel by: nothing is booked, and
      run_as cannot be pointed at an account with no access there. While
      the switch is on it refuses: reading would start from the old
      switch-on and book twice what the desk typed in by hand.
   2. With it (switch off, the script, switch on), the reader books the CRS
      booking at AMR as the new account - a Viewer there and nowhere else,
      with no sign-in.
   3. A second run writes nothing.
   4. Anything unexpected is refused, and nothing changes.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try { return (await db.query(text, params)).rows as Record<string, unknown>[]; }
  finally { await db.end(); }
};

/* psql as with-test-db.sh finds it: told, the local cluster's, or the PATH's. */
const PGBIN = process.env["PGBIN"] ?? "D:/fidato pms/.local/pg/pgsql/bin";
const PSQL = process.env["PSQL"]
  ?? [`${PGBIN}/psql.exe`, `${PGBIN}/psql`].find((p) => existsSync(p)) ?? "psql";
const SCRIPT = fileURLToPath(new URL("../../../../deploy/crs-run-as.sql", import.meta.url));

const runScript = (...vars: string[]) => {
  const r = spawnSync(PSQL, ["-X", "-d", SUPER, ...vars.flatMap((v) => ["-v", v]), "-f", SCRIPT],
    { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const EMAIL = "crs+amr@fidatohotels.com";
const CRS_HOTEL = "crsAmrapaliTest";
let amr = "";
let owner = "";
let first = "";

const setup = (method: string, body?: unknown) =>
  app.request("/api/hotels/AMR/crs/setup", {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/* ── A fake CRS: sign-in, the changed-since query, the deleted check ── */

const store = new Map<string, Record<string, unknown>>();
const enc = (v: unknown): Record<string, unknown> => {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return /^\d{4}-\d\d-\d\dT/.test(v) ? { timestampValue: v } : { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, enc(x)])) } };
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fakeCrs: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (url.includes("accounts:signInWithPassword")) return json({ idToken: "fake", expiresIn: "3600" });
  if (url.endsWith(":runQuery")) {
    const since = Date.parse(body.structuredQuery.where.fieldFilter.value.timestampValue);
    return json([...store.entries()]
      .filter(([, d]) => Date.parse(String(d["updatedAt"])) >= since)
      .map(([id, d]) => ({ document: {
        name: `projects/p/databases/(default)/documents/reservations/${id}`,
        fields: (enc(d) as { mapValue: { fields: unknown } }).mapValue.fields,
      } })));
  }
  if (url.endsWith(":batchGet")) {
    return json((body.documents as string[]).map((n) => ({ found: { name: n, fields: {} } })));
  }
  throw new Error(`The fake CRS was asked ${url}`);
};

/** A made-up booking in the live CRS's shape (its src/data/types.ts), made
    after the hotel was connected, for one Standard room on CP. */
const crsBooking = (reference: string) => {
  const at = new Date(Date.now() + 60_000).toISOString();
  const checkIn = new Date(Date.parse(`${first}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const checkOut = new Date(Date.parse(`${checkIn}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  return {
    reference, status: "confirmed", channel: "direct_sales",
    customerId: "cust1", customerName: "Test Guest",
    hotelId: CRS_HOTEL, hotelName: "Amrapali test hotel", hotelCity: "Nowhere",
    checkIn, checkOut, nights: 2,
    rooms: [{
      roomTypeId: "crsSTD", roomTypeName: "Standard", mealPlan: "CP",
      quantity: 1, adults: 2, children: 0, extraBeds: 0,
      sellingRate: 3500, extraBedRate: 0, childRate: 0,
    }],
    guests: [{ name: "Test Guest", email: "", phone: "", isPrimary: true }],
    totalRooms: 1, totalAdults: 2, totalChildren: 0,
    ownerId: "sales1", ownerName: "Test Salesperson",
    notifyGuest: false, specialRequests: "", internalNotes: "",
    hotelRepName: "PMS test", confirmedAt: at,
    createdAt: at, updatedAt: at,
  };
};

const SETTINGS = {
  CRS_PROJECT_ID: "test-project", CRS_API_KEY: "test-web-key",
  CRS_AUTOMATION_EMAIL: "automation@example.com", CRS_AUTOMATION_PASSWORD: "not-a-real-password",
};
/* Through the real app.crs_due(), kept to AMR so another file's hotel in this
   database is not read with this file's fake CRS. */
const run = () => runOnce(async () => (await dueHotels()).filter((h) => h.hotelId === amr));
const stays = (crsId: string) => sql(
  `select r.id::text, r.status, h.code from reservations r join hotels h on h.id = r.hotel_id
    where r.ota_reference = $1`, [crsId]);
const state = async () => (await sql(
  `select (select to_jsonb(s) from staff s where s.email = $1) as staff,
          (select jsonb_agg(to_jsonb(sh) order by sh.hotel_id) from staff_hotels sh
             join staff s on s.id = sh.staff_id where s.email = $1) as access,
          (select to_jsonb(ch) from crs_hotels ch where ch.hotel_id = $2) as crs,
          (select count(*)::int from audit_log
            where table_name in ('staff', 'staff_hotels', 'crs_hotels')) as audited`,
  [EMAIL, amr]))[0]!;

/** The card "Connection to the CRS", saved by the owner: its CRS id, the
    source, Standard matched, and the switch. */
const card = async (isOn: boolean) => {
  const source = String((await sql(
    "select id::text from booking_sources where name = 'Fidato Hotels'"))[0]!["id"]);
  const std = String((await sql(
    "select id::text from room_types where hotel_id = $1 and code = 'STD'", [amr]))[0]!["id"]);
  const saved = await setup("PUT", {
    crsHotelId: CRS_HOTEL, bookingSourceId: source, isOn,
    roomTypes: [{ crsRoomTypeId: "crsSTD", roomTypeId: std }],
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
};

/** The script refused, said so, and nothing it could touch moved. */
const refused = async (why: RegExp, ...vars: string[]) => {
  const before = await state();
  const r = runScript(...vars);
  expect(r.status, r.out).not.toBe(0);
  expect(r.out).toMatch(why);
  expect(r.out).toContain("Nothing was changed");
  expect(await state()).toEqual(before);
};

beforeAll(async () => {
  Object.assign(process.env, SETTINGS);
  useFetchForTests(fakeCrs);
  owner = String((await sql("select id::text from staff where email = 'owner@fidato.in'"))[0]!["id"]);

  /* AMR as live made it: provisioned, then a room type and its rooms added. */
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    amr = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked('AMR','Amrapali test hotel','Nowhere','MH',null,'none')::text as id"))
      .rows[0]!.id;
    const std = (await db.query<{ id: string }>(
      `insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy)
       values ($1, 'STD', 'Standard', 2, 3) returning id::text`, [amr])).rows[0]!.id;
    await db.query(
      `insert into rooms (hotel_id, room_type_id, number) values ($1, $2, '101'), ($1, $2, '102')`,
      [amr, std]);
  } finally { await db.end(); }
  first = String((await sql(
    "select greatest(business_date, (now() at time zone timezone)::date)::text as d from hotels where id = $1",
    [amr]))[0]!["d"]);

  /* The card, as the owner may have filled it on live: switched ON already. */
  await card(true);
});

afterEach(() => { store.clear(); });

afterAll(async () => {
  useFetchForTests(null);
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  await closePool();
});

describe("before the script: the hotel is connected, and nobody reads it", () => {
  it("passes the hotel by, books nothing, and the card says why", async () => {
    store.set("crsDocBefore", crsBooking("FH-2026-09001"));
    await run();
    expect(await stays("crsDocBefore")).toHaveLength(0);
    expect(await sql("select 1 from crs_bookings where crs_id = 'crsDocBefore'")).toHaveLength(0);
    expect((await (await setup("GET")).json() as { readsAs: string | null }).readsAs).toBeNull();
  });

  it("refuses run_as for an account that does not work at the hotel", async () => {
    const pune = String((await sql(
      `select s.id::text from staff s where not s.is_group_admin and s.is_active
          and not exists (select 1 from staff_hotels sh where sh.staff_id = s.id and sh.hotel_id = $1)
        limit 1`, [amr]))[0]!["id"]);
    await expect(sql("update crs_hotels set run_as = $1 where hotel_id = $2", [pune, amr]))
      .rejects.toThrow(/has no access to hotel/);
  });

  it("is not given an account while switched on: that would read from the old switch-on", () =>
    refused(/Reading is switched ON at AMR with no account to read as/, "hotel=AMR"));
});

describe("deploy/crs-run-as.sql, the first run (the card switched off first)", () => {
  beforeAll(() => card(false));

  it("makes the account, a Viewer at AMR alone, and points the reader at it", () => {
    const r = runScript("hotel=AMR");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`Made the service account ${EMAIL} (no sign-in).`);
    expect(r.out).toContain("Gave it Viewer (read_only) at AMR, and nothing anywhere else.");
    expect(r.out).toContain(`The CRS reader at AMR now runs as ${EMAIL}.`);
    expect(r.out).toContain("Reading is switched OFF at AMR");
    expect(r.out).toMatch(/AMR\s*\|\s*crs\+amr@fidatohotels\.com\s*\|\s*read_only\s*\|\s*f\s*\|\s*1/);
  });

  it("is exactly that account: no sign-in, not an administrator, one hotel", async () => {
    const [s] = await sql(
      `select s.id::text, s.firebase_uid, s.is_group_admin, s.is_active,
              (select array_agg(sh.role || '@' || h.code) from staff_hotels sh
                 join hotels h on h.id = sh.hotel_id where sh.staff_id = s.id) as access,
              (select run_as::text from crs_hotels where hotel_id = $2) as run_as
         from staff s where s.email = $1`, [EMAIL, amr]);
    expect(s).toMatchObject({ firebase_uid: null, is_group_admin: false, is_active: true,
      access: ["read_only@AMR"], run_as: s!["id"] });
    /* Switched off: still not read. */
    expect((await dueHotels()).map((h) => h.hotelId)).not.toContain(amr);
  });

  it("once switched on, lets the reader book a CRS booking at AMR, as that account", async () => {
    await card(true);
    const [{ id }] = await sql("select id::text from staff where email = $1", [EMAIL]) as [{ id: string }];
    expect(await dueHotels()).toContainEqual({ hotelId: amr, runAs: id });
    store.set("crsDocAfter", crsBooking("FH-2026-09002"));
    await run();
    const made = await stays("crsDocAfter");
    expect(made).toEqual([expect.objectContaining({ status: "tentative", code: "AMR" })]);
    expect((await sql("select outcome from crs_bookings where crs_id = 'crsDocAfter'"))[0])
      .toEqual({ outcome: "booked" });
    const [audit] = await sql(
      `select s.email from audit_log a join staff s on s.id = a.actor
        where a.table_name = 'reservations' and a.action = 'INSERT' and a.row_id = $1`,
      [made[0]!["id"]]);
    expect(audit).toEqual({ email: EMAIL });
    expect((await (await setup("GET")).json() as { readsAs: string }).readsAs)
      .toBe("CRS reader (AMR, service account)");
  });
});

describe("deploy/crs-run-as.sql, run again", () => {
  it("writes nothing and says so", async () => {
    const before = await state();
    const r = runScript("hotel=amr");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`Nothing to change: the CRS reader at AMR already runs as ${EMAIL}.`);
    expect(await state()).toEqual(before);
  });
});

describe("deploy/crs-run-as.sql refuses, changing nothing", () => {
  it("with no hotel named", () => refused(/Say which hotel/));

  it("for a hotel that is not there", () => refused(/no hotel with the code NOPE/, "hotel=NOPE"));

  it("for a hotel not connected to the CRS yet", async () => {
    const code = String((await sql(
      `select h.code from hotels h where h.is_active and h.code <> 'AMR'
          and not exists (select 1 from crs_hotels c where c.hotel_id = h.id)
        order by h.code limit 1`))[0]!["code"]);
    await refused(new RegExp(`Hotel ${code} is not connected to the CRS yet`), `hotel=${code}`);
  });

  it("when the reader already runs as somebody else", async () => {
    const [{ run_as: was }] = await sql("select run_as::text from crs_hotels where hotel_id = $1", [amr]) as [{ run_as: string }];
    await sql("update crs_hotels set run_as = $1 where hotel_id = $2", [owner, amr]);
    try {
      await refused(/already runs as owner@fidato\.in/, "hotel=AMR");
    } finally {
      await sql("update crs_hotels set run_as = $1 where hotel_id = $2", [was, amr]);
    }
  });

  it("when the account holds any other access", async () => {
    const other = String((await sql("select id::text from hotels where code <> 'AMR' and is_active order by code limit 1"))[0]!["id"]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select id, $2, 'read_only' from staff where email = $1",
      [EMAIL, other]);
    try {
      await refused(/holds other access/, "hotel=AMR");
    } finally {
      await sql("delete from staff_hotels where hotel_id = $2 and staff_id = (select id from staff where email = $1)",
        [EMAIL, other]);
    }
  });
});
