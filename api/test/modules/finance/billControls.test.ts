import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   MONEY OFF A BILL, ONLY WITH A REASON - QA FI-4, FI-5 (28 September)

   Reception could post a −₹50 "charge" (a discount nobody approved), and
   reverse any charge or payment on one click, with no reason. The owner:
   "Are you sure?" with a REQUIRED reason (D27-117), and a payment is
   reversed only by the owner, an administrator, the GM or the accountant
   (D27-125).

   Its own property (BCT), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "BCT";
let hotelId = "";
let stayId = "";
let deskId = "";
let gmId = "";

const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${CODE}/stays/${stayId}${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

const person = async (key: string, role: string) => {
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`bct-${key}@fidato.in`, `BCT ${key}`, `test-uid-bct-${key}`]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
    [row!.id, hotelId, role]);
  return row!.id;
};

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Bill Controls Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query("insert into guests (full_name) values ('Bill controls guest')");
    stayId = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1),
               (select id from guests where full_name = 'Bill controls guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               app.business_date($1), app.business_date($1) + 1, 2000, 'checked_in')
       returning id::text`, [hotelId])).rows[0]!.id;
  } finally { await db.end(); }
  deskId = await person("desk", "front_desk");
  gmId = await person("gm", "gm");
  const rule = await app.request(`/api/hotels/${CODE}/tax/room`, {
    method: "PUT",
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    body: JSON.stringify({ slabs: [{ overAmount: 0, rate: 5 }] }),
  });
  expect(rule.status, await rule.clone().text()).toBe(200);
});

afterAll(async () => {
  await closePool();
  const db = await admin();
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("delete from staff where email like 'bct-%@fidato.in'");
  } finally {
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
}, 120_000);

const lines = async () => (await sql<{ n: number }>(
  `select count(*)::int as n from folio_postings fp join folios f on f.id = fp.folio_id
    where f.reservation_id = $1`, [stayId]))[0]!.n;

describe("a charge (FI-4)", () => {
  it("of less than nothing is refused, and nothing is written", async () => {
    const before = await lines();
    const res = await call(deskId, "/charges",
      { category: "Food", description: "QA negative test", amount: -50, taxable: true });
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.reason).toMatch(/reverse the charge/);
    expect(await lines()).toBe(before);
  });
});

describe("a reversal (FI-5)", () => {
  let charge = "";
  let payment = "";

  beforeAll(async () => {
    const c = await call(deskId, "/charges",
      { category: "Food", description: "Two coffees", amount: 200, taxable: true });
    charge = ((await c.json()) as { data: { id: string } }).data.id;
    const p = await call(deskId, "/payments", { method: "UPI", amount: 100 });
    payment = ((await p.json()) as { data: { id: string } }).data.id;
  });

  it("with no reason is refused, and nothing is written", async () => {
    const before = await lines();
    const res = await call(deskId, `/charges/${charge}/reverse`, { reason: "  " });
    expect(res.status).toBe(409);
    expect(await lines()).toBe(before);
  });

  it("of a charge, by reception, keeps the reason on the reversal's line", async () => {
    const res = await call(deskId, `/charges/${charge}/reverse`, { reason: "Posted to the wrong room" });
    const body = await res.json() as { ok: boolean; data: { id: string } };
    expect(res.status, JSON.stringify(body)).toBe(200);
    const [line] = await sql<{ description: string }>(
      "select description from folio_postings where id = $1", [body.data.id]);
    expect(line!.description).toMatch(/Posted to the wrong room/);
  });

  it("of a payment is refused to reception", async () => {
    const before = await lines();
    const res = await call(deskId, `/charges/${payment}/reverse`, { reason: "Wrong amount" });
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.reason).toMatch(/general manager or the accountant/);
    expect(await lines()).toBe(before);
  });

  it("of a payment is the GM's to make", async () => {
    const res = await call(gmId, `/charges/${payment}/reverse`, { reason: "Wrong amount" });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("cash (D27-118, QA FI-13)", () => {
  it("is refused while the person taking it has no drawer open, and nothing is written", async () => {
    const before = await lines();
    const res = await call(deskId, "/payments", { method: "Cash", amount: 100, heldAsCredit: true });
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.reason).toMatch(/Open your cash drawer first/);
    expect(await lines()).toBe(before);
  });

  it("is taken into the drawer once it is open, and the drawer counts it", async () => {
    const open = await app.request(`/api/hotels/${CODE}/cashier-shift/open`, {
      method: "POST",
      headers: { "x-dev-staff-id": deskId, "content-type": "application/json" },
      body: JSON.stringify({ opening: 0 }),
    });
    expect(open.status, await open.clone().text()).toBe(200);
    const res = await call(deskId, "/payments", { method: "Cash", amount: 100, heldAsCredit: true });
    expect(res.status, await res.clone().text()).toBe(200);
    const [drawer] = await sql<{ expected: string }>(
      `select app.cashier_expected_cash(id)::text as expected from cashier_shifts
        where staff_id = $1 and closed_at is null`, [deskId]);
    expect(Number(drawer!.expected)).toBe(100);
  });
});

describe("counting the drawer (QA FI-10)", () => {
  it("refuses a negative count whole, and keeps the count it had", async () => {
    const count = (denominations: unknown) => app.request(`/api/hotels/${CODE}/cashier-shift/count`, {
      method: "POST",
      headers: { "x-dev-staff-id": deskId, "content-type": "application/json" },
      body: JSON.stringify({ denominations }),
    });
    expect((await count([{ value: 100, count: 1 }])).status).toBe(200);
    const res = await count([{ value: 500, count: -3 }, { value: 100, count: 2 }]);
    expect(res.status, await res.clone().text()).toBe(409);
    const [shift] = await sql<{ counted: string }>(
      "select counted_cash::text as counted from cashier_shifts where staff_id = $1 and closed_at is null",
      [deskId]);
    expect(Number(shift!.counted)).toBe(100);
  });
});

describe("a figure too large to keep (QA FI-12)", () => {
  it("is a plain refusal, not a server error, and nothing is written", async () => {
    const before = await lines();
    const res = await call(deskId, "/charges",
      { category: "Food", description: "Too much", amount: 99999999999, taxable: true });
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.reason).toMatch(/too large/);
    expect(await lines()).toBe(before);
  });
});
