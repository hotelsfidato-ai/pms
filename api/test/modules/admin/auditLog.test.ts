import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE AUDIT LOG NAMES THE PERSON — ADM-1, D17-14

   The route typed "admin" as the person on every entry. Behind that,
   the desk's charge, reversal and payment never recorded who made them
   at all: 148 of 176 postings in the development database named nobody
   on 17 September. The owner's answer: RECORD and SHOW the real person.

   So this goes through the real doors a receptionist uses — finance's
   charge, payment and reversal routes, which are not this service's and
   were not changed — and then reads the audit log as each role that may.

   Everything posted is reversed, so every bill ends where it started.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const CLERK_NAME = "ADM1TEST Accountant";

let ownerId: string;
let clerkId: string;
let gmId: string;
let adminId: string;
let stayId: string;
const made: string[] = [];

interface Entry { id: string; actor: string | null; action: string; kind: string }

const post = async (staffId: string, path: string, body: unknown) => {
  const res = await app.request(`/api/hotels/${HOTEL}/stays/${stayId}${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; reason?: string; data?: { id: string } };
  expect(res.status, `${path}: ${JSON.stringify(json)}`).toBe(200);
  return json.data!.id;
};

const auditLogAs = async (staffId: string) => {
  const res = await app.request(`/api/hotels/${HOTEL}/audit-log`, {
    headers: { "x-dev-staff-id": staffId },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Entry[];
};

const person = async (key: string, name: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`adm1-${key}@fidato.in`, name, `test-uid-adm1-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  return id;
};

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  /* The accountant: the one role that may post all four acts below itself -
     since D27-125 a payment is reversed only by the owner, an administrator,
     the GM or the accountant (finance's round A, 28 September). */
  clerkId = await person("clerk", CLERK_NAME, "finance");
  gmId = await person("gm", "ADM1TEST General Manager", "gm");
  adminId = await person("admin", "ADM1TEST Administrator", "admin");

  stayId = (await sql(
    `select r.id::text as id from folios f
       join reservations r on r.id = f.reservation_id
       join hotels h on h.id = f.hotel_id
      where h.code = $1 and r.status = 'checked_in' and f.status = 'open'
      order by r.check_in limit 1`, [HOTEL])).rows[0].id as string;

  /* The desk's three acts, as the clerk, through finance's own routes. */
  const charge = await post(clerkId, "/charges",
    { category: "Laundry", description: "ADM1TEST laundry", amount: 150, taxable: false });
  const payment = await post(clerkId, "/payments", { method: "Cash", amount: 150 });
  const chargeBack = await post(clerkId, `/charges/${charge}/reverse`, { reason: "ADM1TEST" });
  const paymentBack = await post(clerkId, `/charges/${payment}/reverse`, { reason: "ADM1TEST" });
  made.push(charge, payment, chargeBack, paymentBack);
});

afterAll(async () => {
  await sql(
    `delete from staff_hotels where staff_id in
       (select id from staff where email like 'adm1-%@fidato.in')`);
  await sql("update staff set is_active = false where email like 'adm1-%@fidato.in'");
  await closePool();
});

describe("recorded - the desk's postings say who made them", () => {
  it("a charge, a payment and both reversals record the clerk", async () => {
    const { rows } = await sql(
      "select id::text, posted_by::text from folio_postings where id = any($1::bigint[])",
      [made]);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.posted_by, `posting ${r.id} recorded nobody`).toBe(clerkId);
    }
  });

  it("and the bill ends where it started", async () => {
    const { rows } = await sql(
      "select coalesce(sum(amount), 0)::numeric as net from folio_postings where id = any($1::bigint[])",
      [made]);
    expect(Number(rows[0].net)).toBe(0);
  });
});

/* ADM-4: two links to this log pointed at /h/<code>/admin/audit-log, where
   nothing is mounted, so the person landed on the Dashboard. The screen is
   /admin/audit-log (src/modules/admin/routes.tsx). The two reversals above
   are what put the bell's entry up. */
describe("the links to it go where the screen is (ADM-4)", () => {
  it("the night-audit checklist and the bell both link to /admin/audit-log", async () => {
    const get = async (path: string) => {
      const res = await app.request(`/api/hotels/${HOTEL}${path}`, {
        headers: { "x-dev-staff-id": ownerId },
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return res.json();
    };
    const { checks } = (await get("/night-audit")) as { checks: { id: string; link?: string }[] };
    expect(checks.find((c) => c.id === "reversals")?.link).toBe("/admin/audit-log");

    const bell = (await get("/notifications")) as { id: string; link: string }[];
    expect(bell.find((n) => n.id === "reversals-today")?.link).toBe("/admin/audit-log");
  });
});

describe("shown - the audit log names them", () => {
  it.each([
    ["the owner", () => ownerId],
    ["an administrator", () => adminId],
    ["the general manager", () => gmId],
  ])("%s reads the clerk's name on all four", async (_who, as) => {
    const log = await auditLogAs(as());
    const mine = log.filter((e) => made.includes(e.id));
    expect(mine).toHaveLength(4);
    for (const e of mine) expect(e.actor, `${e.action} ${e.id}`).toBe(CLERK_NAME);
  });

  it("the word \"admin\" is never a stand-in for a person", async () => {
    const log = await auditLogAs(ownerId);
    const names = new Set((await sql("select full_name from staff")).rows.map((r) => r.full_name));
    for (const e of log) {
      if (e.actor !== null) expect(names, `${e.id} names "${e.actor}"`).toContain(e.actor);
    }
    expect(log.some((e) => e.actor === "admin")).toBe(false);
  });

  it("an entry nobody recorded says so - null, which the screen prints as a dash", async () => {
    /* The demo's postings were bulk-loaded with nobody signed in. */
    const log = await auditLogAs(ownerId);
    expect(log.some((e) => e.actor === null)).toBe(true);
  });

  it("somebody whose access is removed is still named on what they did", async () => {
    await sql("delete from staff_hotels where staff_id = $1", [clerkId]);
    await sql("update staff set is_active = false where id = $1", [clerkId]);
    const log = await auditLogAs(gmId);
    const mine = log.filter((e) => made.includes(e.id));
    expect(mine).toHaveLength(4);
    for (const e of mine) expect(e.actor).toBe(CLERK_NAME);
  });
});
