import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   CONTRACTS (D27-178; the owner's D27-184, C-1 to C-13) - the rules the
   server holds, each counted in the database afterwards

     a company      reception adds one without credit (C-7); a mistyped
                    GSTIN and a second one of a name are refused (C-11); an
                    administrator changes one (013 refused them, C-6)
     a contract     one in force at a time, said in words (C-3); commission
                    is an agent's (C-8)
     the booking    priced by the contract in force on arrival, which it
                    stamps with its commission (C-2, C-3, C-8); a typed rate
                    still overrides it (C-5)
     the credit     Bill to company refused for a company not allowed
                    credit (C-9), and nothing written
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "CTRT";
let hotelId: string;
let typeId: string;
let source: string;
const staff = new Map<string, string>();

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`ctrt-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-ctrt-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
    [id, hotelId, role]);
  return id;
};

const call = (role: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;
const companies = async (name: string) => (await sql(
  "select count(*)::int as n from companies where name = $1", [name])).rows[0].n as number;

const contract = (over: Record<string, unknown> = {}) => ({
  name: `${TAG} 2029`, validFrom: "2029-01-01", validTo: "2029-12-31", pricing: "rates",
  rates: [{ roomTypeId: typeId, mealPlan: "EP", single: 2500, double: 2800 }], ...over,
});

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  typeId = (await sql(
    `select id::text from room_types where hotel_id = $1 and is_active
      order by sort_order limit 1`, [hotelId])).rows[0].id;
  source = (await sql(
    "select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  for (const role of ["front_desk", "admin", "gm"]) staff.set(role, await person(role));
});

afterAll(async () => {
  const { rows } = await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id
      where g.full_name like $1`, [`${TAG} %`]);
  const ids = rows.map((r) => r.id as string);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("delete from contract_rates where contract_id in (select id from contracts where name like $1)", [`${TAG} %`]);
  await sql("delete from contracts where name like $1", [`${TAG} %`]);
  await sql("delete from companies where name like $1", [`${TAG} %`]);
  await sql("alter table guests disable trigger guests_no_delete");
  try {
    await sql("delete from guests where full_name like $1", [`${TAG} %`]);
  } finally {
    await sql("alter table guests enable trigger guests_no_delete");
  }
  const ids2 = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [ids2]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [ids2]);
  await closePool();
});

describe("a company's record", () => {
  it("reception adds one without credit; credit is refused them, and nothing is written (C-7)", async () => {
    const name = `${TAG} Desk Firm`;
    const refused = await call("front_desk", "POST", "/companies", { name, creditAllowed: true });
    expect(refused.status).toBe(409);
    expect(await reasonOf(refused)).toMatch(/^Credit is given by the owner, an administrator or the general manager/);
    expect(await companies(name)).toBe(0);

    const added = await call("front_desk", "POST", "/companies",
      { name, gstin: "27aapfu0939f1zv", addressLine: "1 Station Road", pincode: "411001" });
    expect(added.status, await added.clone().text()).toBe(200);
    const { rows } = await sql(
      "select kind, gstin, credit_allowed, credit_days, credit_limit from companies where name = $1", [name]);
    expect(rows[0]).toEqual({ kind: "corporate", gstin: "27AAPFU0939F1ZV", credit_allowed: false,
                              credit_days: null, credit_limit: null });
  });

  it("refuses a mistyped GSTIN and a second company of one name (C-11)", async () => {
    const wrong = await call("gm", "POST", "/companies", { name: `${TAG} Typo`, gstin: "27AAPFU0939F1ZW" });
    expect(await reasonOf(wrong)).toMatch(/mistyped/);
    expect(await companies(`${TAG} Typo`)).toBe(0);
    const twice = await call("gm", "POST", "/companies", { name: `${TAG} desk firm` });
    expect(twice.status).toBe(409);
    expect(await reasonOf(twice)).toMatch(/is already on the list/);
  });

  it("an administrator changes a company, which 013 refused them; reception changes none (C-6)", async () => {
    const id = (await sql("select id::text from companies where name = $1", [`${TAG} Desk Firm`])).rows[0].id;
    expect((await call("front_desk", "PATCH", `/companies/${id}`, { city: "Pune" })).status).toBe(403);
    const res = await call("admin", "PATCH", `/companies/${id}`,
      { city: "Pune", creditAllowed: true, creditDays: 30 });
    expect(res.status, await res.clone().text()).toBe(200);
    const { rows } = await sql("select city, credit_allowed, credit_days, gstin from companies where id = $1", [id]);
    expect(rows[0]).toEqual({ city: "Pune", credit_allowed: true, credit_days: 30, gstin: "27AAPFU0939F1ZV" });
  });
});

describe("a duplicate already on file (the demo loaded twice)", () => {
  it("is still edited, to tick its credit (D27-185); a rename onto another name is refused", async () => {
    const twins = (await sql(
      `insert into companies (name) values ($1), ($1) returning id::text`, [`${TAG} Twin`])).rows;
    const tick = await call("gm", "PATCH", `/companies/${twins[0].id}`, { creditAllowed: true });
    expect(tick.status, await tick.clone().text()).toBe(200);
    const desk = (await sql("select id::text from companies where name = $1", [`${TAG} Desk Firm`])).rows[0].id;
    const rename = await call("gm", "PATCH", `/companies/${desk}`, { name: `${TAG} Twin` });
    expect(await reasonOf(rename)).toMatch(/is already on the list/);
  });
});

describe("a contract", () => {
  let agent: string;
  beforeAll(async () => {
    const res = await call("gm", "POST", "/companies", { name: `${TAG} Agent`, kind: "travel_agent" });
    agent = ((await res.json()) as { id: string }).id;
  });

  it("one in force at a time, refused in words; commission is an agent's (C-3, C-8)", async () => {
    const made = await call("gm", "POST", "/contracts", { ...contract(), companyId: agent, commissionPct: 12 });
    expect(made.status, await made.clone().text()).toBe(200);
    const again = await call("gm", "POST", "/contracts",
      { ...contract({ name: `${TAG} overlap`, validFrom: "2029-12-01", validTo: "2030-03-31" }), companyId: agent });
    expect(again.status).toBe(409);
    expect(await reasonOf(again)).toMatch(/already has "CTRT 2029" here from 1 Jan 2029 to 31 Dec 2029/);

    const corporate = (await sql("select id::text from companies where name = $1", [`${TAG} Desk Firm`])).rows[0].id;
    const commission = await call("gm", "POST", "/contracts",
      { ...contract({ name: `${TAG} corp` }), companyId: corporate, commissionPct: 5 });
    expect(await reasonOf(commission)).toMatch(/Commission is agreed with a travel agent/);
    expect((await sql("select count(*)::int as n from contracts where name like $1", [`${TAG} %`])).rows[0].n).toBe(1);
    expect((await call("front_desk", "POST", "/contracts", { ...contract(), companyId: agent })).status).toBe(403);
  });

  it("prices the booking naming the company, stamping it and its commission; a typed rate still wins (C-2, C-5)", async () => {
    const quote = await call("front_desk", "GET",
      `/contract-price?companyId=${agent}&roomType=${typeId}&mealPlan=EP&from=2029-05-10&to=2029-05-12&adults=2&children=0`);
    const q = (await quote.json()) as { total: number; contract: { name: string } };
    expect([q.total, q.contract.name]).toEqual([5600, `${TAG} 2029`]);

    const book = (name: string, line: Record<string, unknown> = {}) => call("front_desk", "POST", "/bookings", {
      guestName: `${TAG} ${name}`, checkIn: "2029-05-10", checkOut: "2029-05-12",
      bookingSourceId: source, companyId: agent,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, children: 0, rooms: 1, ...line }],
    });
    const priced = await book("Under contract");
    expect(priced.status, await priced.clone().text()).toBe(200);
    const typed = await book("Typed rate", { agreedRate: 3100 });
    expect(typed.status).toBe(200);
    const { rows } = await sql(
      `select g.full_name as guest, r.agreed_rate::float8 as rate, r.commission_pct::float8 as commission,
              k.name as contract
         from reservations r join guests g on g.id = r.guest_id
         left join contracts k on k.id = r.contract_id
        where g.full_name like $1 order by g.full_name`, [`${TAG} %`]);
    expect(rows).toEqual([
      { guest: `${TAG} Typed rate`, rate: 3100, commission: 12, contract: `${TAG} 2029` },
      { guest: `${TAG} Under contract`, rate: 2500, commission: 12, contract: `${TAG} 2029` },
    ]);
  });

  it("Bill to company is refused for a company not allowed credit, and nothing is written (C-9)", async () => {
    const stay = (await sql(
      `select r.id::text from reservations r join guests g on g.id = r.guest_id
        where g.full_name = $1`, [`${TAG} Under contract`])).rows[0].id;
    const pay = () => call("front_desk", "POST", `/stays/${stay}/payments`,
      { method: "Bill to company", amount: 100 });
    const refused = await pay();
    expect(refused.status).toBe(409);
    expect(await reasonOf(refused)).toBe(`${TAG} Agent is not allowed credit. Take the payment another way, `
      + "or ask the owner, an administrator or the general manager to allow credit on its record.");

    await sql("update companies set credit_allowed = true where id = $1", [agent]);
    /* Past the credit rule, the next one answers (D27-4): still nothing written. */
    expect(await reasonOf(await pay())).toMatch(/more than the bill/);
    expect((await sql(
      `select count(*)::int as n from folio_postings fp join folios f on f.id = fp.folio_id
        where f.reservation_id = $1`, [stay])).rows[0].n).toBe(0);
  });

  it("never prices a day use: its price is typed even under a contract (D27-229)", async () => {
    const dayUse = (rate?: number) => call("front_desk", "POST", "/bookings", {
      guestName: `${TAG} Day use`, checkIn: "2029-05-11", checkOut: "2029-05-11",
      bookingSourceId: source, companyId: agent,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, children: 0, rooms: 1,
                ...(rate === undefined ? {} : { agreedRate: rate }) }],
    });
    const untyped = await dayUse();
    expect(untyped.status).toBe(409);
    expect(await reasonOf(untyped)).toBe("Type the day-use price.");
    const typed = await dayUse(1500);
    expect(typed.status, await typed.clone().text()).toBe(200);
    const { rows } = await sql(
      `select r.agreed_rate::float8 as rate, k.name as contract
         from reservations r join guests g on g.id = r.guest_id
         left join contracts k on k.id = r.contract_id
        where g.full_name = $1`, [`${TAG} Day use`]);
    expect(rows).toEqual([{ rate: 1500, contract: `${TAG} 2029` }]);
  });
});
