import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   MONEY IN THE SETTINGS CONSOLE - the owner's D27-259, migration 192

   Each hotel's ways of paying (the word on the bill, what it is in the
   books, On/Off, the default), its extra charges (a pickup marked so) and
   its room discounts (% or ₹). Its own property (MNY), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () => new (await import("pg")).default.Pool({ connectionString: SUPER });
async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "MNY";
let hotelId = "", stayId = "", deskId = "", gmId = "";

const as = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;
type Method = { id: string; label: string; kind: string; isActive: boolean; used: boolean };
const methods = async () => (await (await as(gmId, "GET", "/payment-methods")).json()) as
  { methods: Method[]; defaultMethod: string };
const idOf = async (label: string) => (await methods()).methods.find((m) => m.label === label)!.id;

const person = async (key: string, role: string) => {
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`mny-${key}@fidato.in`, `MNY ${key}`, `test-uid-mny-${key}`]);
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
      "select app.provision_property_unchecked($1,'Money Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query("insert into guests (full_name) values ('Money test guest')");
    stayId = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1),
               (select id from guests where full_name = 'Money test guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               app.business_date($1), app.business_date($1) + 1, 2000, 'checked_in')
       returning id::text`, [hotelId])).rows[0]!.id;
  } finally { await db.end(); }
  deskId = await person("desk", "front_desk");
  gmId = await person("gm", "gm");
  const rule = await as("dev-owner", "PUT", "/tax/room", { slabs: [{ overAmount: 0, rate: 5 }] });
  expect(rule.status, await rule.clone().text()).toBe(200);
  const charge = await as(deskId, "POST", `/stays/${stayId}/charges`,
    { category: "Food", description: "Dinner", amount: 3000, taxable: true });
  expect(charge.status, await charge.clone().text()).toBe(200);
});

afterAll(async () => {
  await closePool();
  const db = await admin();
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("delete from staff where email like 'mny-%@fidato.in'");
  } finally {
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
}, 120_000);

describe("payment methods (D27-259 Q1, Q2)", () => {
  it("a new property starts with the five the screens offered, Cash the default", async () => {
    const m = await methods();
    expect(m.methods.map((x) => [x.label, x.kind])).toEqual([
      ["Cash", "cash"], ["UPI", "upi"], ["Credit Card", "card"], ["Debit Card", "card"],
      ["Bill to company", "city_ledger"]]);
    expect(m.defaultMethod).toBe("Cash");
  });

  it("are the owner's, an administrator's or the GM's to change, not the desk's", async () => {
    expect((await as(deskId, "POST", "/payment-methods", { label: "GPay", kind: "upi" })).status).toBe(403);
    expect((await as(gmId, "POST", "/payment-methods", { label: "Agoda", kind: "bank" })).status).toBe(409);
    expect((await as(gmId, "POST", "/payment-methods", { label: "GPay", kind: "upi" })).status).toBe(200);
    expect((await as(gmId, "POST", "/payment-methods", { label: "Agoda", kind: "city_ledger" })).status).toBe(200);
    expect(await reason(await as(gmId, "POST", "/payment-methods", { label: "gpay ", kind: "upi" })))
      .toMatch(/already on the list/);
  });

  it("reach the screens through the hotel, in order, only those On", async () => {
    await as(gmId, "PATCH", `/payment-methods/${await idOf("Debit Card")}`, { isActive: false });
    const ids = (await methods()).methods.map((x) => x.id).reverse();
    expect((await as(gmId, "PUT", "/payment-methods/order", { ids })).status).toBe(200);
    const { hotels } = (await (await app.request("/api/hotels",
      { headers: { "x-dev-staff-id": deskId } })).json()) as
      { hotels: { code: string; deskRules: { paymentMethods: { label: string }[] } }[] };
    expect(hotels.find((h) => h.code === CODE)!.deskRules.paymentMethods.map((p) => p.label))
      .toEqual(["Agoda", "GPay", "Bill to company", "Credit Card", "UPI", "Cash"]);
  });

  it("are what the payment door takes: the label kept, an OTA by name, one that is Off refused", async () => {
    const gpay = await as(deskId, "POST", `/stays/${stayId}/payments`, { method: "GPay", amount: 100 });
    expect(gpay.status, await gpay.clone().text()).toBe(200);
    const agoda = await as(deskId, "POST", `/stays/${stayId}/payments`, { method: "Agoda", amount: 200 });
    expect(agoda.status, await agoda.clone().text()).toBe(200);
    expect(await sql(
      `select p.method, p.method_label, fp.description from payments p
         join folio_postings fp on fp.id = p.posting_id
        where p.hotel_id = $1 order by p.amount`, [hotelId])).toEqual([
      { method: "upi", method_label: "GPay", description: "Received - GPay" },
      { method: "city_ledger", method_label: "Agoda", description: "Transferred to city ledger - Agoda" }]);
    const off = await as(deskId, "POST", `/stays/${stayId}/payments`, { method: "Debit Card", amount: 50 });
    expect(off.status).toBe(409);
    expect(await reason(off)).toMatch(/not a payment method this hotel takes/);
  });

  it("keep the default On; a rename carries it; a used one is switched Off, not deleted", async () => {
    const cash = await idOf("Cash");
    expect(await reason(await as(gmId, "PATCH", `/payment-methods/${cash}`, { isActive: false })))
      .toMatch(/default way of paying/);
    expect(await reason(await as(gmId, "POST", `/payment-methods/${await idOf("Debit Card")}/default`)))
      .toMatch(/must be a payment method that is On/);
    const gpay = await idOf("GPay");
    expect((await as(gmId, "POST", `/payment-methods/${gpay}/default`)).status).toBe(200);
    expect((await as(gmId, "PATCH", `/payment-methods/${gpay}`, { label: "Google Pay" })).status).toBe(200);
    expect((await methods()).defaultMethod).toBe("Google Pay");
    expect(await reason(await as(gmId, "DELETE", `/payment-methods/${await idOf("Agoda")}`)))
      .toMatch(/Switch it Off instead/);
    expect((await as(gmId, "DELETE", `/payment-methods/${await idOf("Debit Card")}`)).status).toBe(200);
  });
});

describe("extra charges (D27-259 Q3, Q6)", () => {
  type Charge = { id: string; name: string; rate: number | null; isTransport: boolean; used: boolean };
  const charges = async () => ((await (await as(gmId, "GET", "/extra-charges")).json()) as
    { charges: Charge[] }).charges;

  it("are priced or included at no charge, and a pickup is marked so", async () => {
    expect(await reason(await as(gmId, "POST", "/extra-charges", { name: "Cake", rate: -1 })))
      .toMatch(/zero or more/);
    expect((await as(gmId, "POST", "/extra-charges",
      { name: "Airport pickup", rate: 1000, category: "misc", isTransport: true })).status).toBe(200);
    expect((await as(gmId, "POST", "/extra-charges", { name: "Welcome drink", rate: null })).status).toBe(200);
    expect((await charges()).map((c) => [c.name, c.rate, c.isTransport]))
      .toEqual([["Airport pickup", 1000, true], ["Welcome drink", null, false]]);
  });

  it("are deleted only when no booking carries one", async () => {
    const [pickup, drink] = await charges();
    const added = await as(deskId, "POST", `/stays/${stayId}/inclusions`,
      { inclusionId: pickup!.id, notes: "06:10, 6E 512" });
    expect(added.status, await added.clone().text()).toBe(200);
    expect(await reason(await as(gmId, "DELETE", `/extra-charges/${pickup!.id}`)))
      .toMatch(/Switch it Off instead/);
    expect((await as(gmId, "DELETE", `/extra-charges/${drink!.id}`)).status).toBe(200);
  });
});

describe("room discounts (D27-259 Q4)", () => {
  it("are a percentage or rupees, never both", async () => {
    expect(await reason(await as(gmId, "POST", "/discounts", { name: "Both", percent: 10, amount: 100 })))
      .toMatch(/one of the two/);
    expect((await as(gmId, "POST", "/discounts", { name: "Long stay", amount: 300 })).status).toBe(200);
    const { discounts } = (await (await as(gmId, "GET", "/discounts")).json()) as
      { discounts: { name: string; percent: number | null; amount: number | null }[] };
    expect(discounts.map((d) => [d.name, d.percent, d.amount])).toEqual([["Long stay", null, 300]]);
  });
});

describe("commission (D27-259 Q5)", () => {
  it("lists each booking source with this hotel's %, a dash where none is agreed", async () => {
    const res = await as(gmId, "GET", "/commission");
    expect(res.status).toBe(200);
    const { sources } = (await res.json()) as { sources: { commissionPct: number | null }[] };
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.commissionPct === null)).toBe(true);
    expect((await as(deskId, "GET", "/commission")).status).toBe(403);
  });
});
