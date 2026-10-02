import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY PAYS WHAT IT OWES - the owner's D27-152, D27-239

   A bill settled "Bill to company" is money the company owes (the City
   ledger's Debit). When the company pays, the desk or accounts records it
   against the company - or the booking site, which has no company record -
   and the City ledger's Opening, Credit and Closing fill in. Append-only:
   a wrong line is reversed by a line of its own, by the four who may
   reverse a payment (D27-125).

   Its own property (CLP), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () => new (await import("pg")).default.Pool({ connectionString: SUPER });
async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "CLP";
const COMPANY = "CLP Ledger Travels";
let hotelId = "";
let today = "";
let tomorrow = "";
let companyId = "";
let sourceId = "";
let sourceName = "";
const people: Record<string, string> = {};

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": who, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Row = { kind: string; cells: Record<string, unknown> };
const ledger = async (from: string, to: string) => {
  const res = await call("dev-owner", `/reports/city-ledger?from=${from}&asOn=${to}`);
  expect(res.status, await res.clone().text()).toBe(200);
  const doc = (await res.json()) as { sections: { rows: Row[] }[] };
  return doc.sections[0]!.rows;
};
const account = (rows: Row[], name: string) => {
  const r = rows.find((x) => x.kind === "row" && x.cells["account"] === name);
  return r && { opening: r.cells["opening"], debit: r.cells["debit"], credit: r.cells["credit"], closing: r.cells["closing"] };
};
const pay = (who: string, body: Record<string, unknown>) =>
  call(who, "/company-payments", "POST",
    { amount: 300, receivedOn: today, method: "bank_transfer", reference: "UTR CLP 1", ...body });

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'City Ledger Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Rooms carry a GST rate here, or the day book refuses the range. */
    await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 5)", [hotelId]);
    ({ d: today, n: tomorrow } = (await db.query<{ d: string; n: string }>(
      "select app.business_date($1)::text as d, (app.business_date($1) + 1)::text as n", [hotelId])).rows[0]!);
    companyId = (await db.query<{ id: string }>(
      `insert into companies (name, credit_allowed) values ($1, true)
       on conflict do nothing returning id::text`, [COMPANY])).rows[0]?.id
      ?? (await db.query<{ id: string }>("select id::text from companies where name = $1", [COMPANY])).rows[0]!.id;
    ({ id: sourceId, name: sourceName } = (await db.query<{ id: string; name: string }>(
      "select id::text, name from booking_sources where kind = 'ota' and is_active order by name limit 1")).rows[0]!);
    const guest = (await db.query<{ id: string }>(
      "insert into guests (full_name) values ('CLP Guest') returning id::text")).rows[0]!.id;
    const stay = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, company_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2,
               (select id from room_types where hotel_id = $1 and code = 'STD'), $3,
               app.business_date($1), app.business_date($1) + 1, 1000, 'confirmed')
       returning id::text`, [hotelId, guest, companyId])).rows[0]!.id;
    const bill = (await db.query<{ id: string }>(
      `insert into folios (hotel_id, reservation_id, bill_to, company_id)
       values ($1, $2, 'company', $3) returning id::text`, [hotelId, stay, companyId])).rows[0]!.id;
    await db.query(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                   amount, tax_rate, tax_amount)
       values ($1, $2, app.business_date($1), 'room', 'Room', 1000, 5, 50)`, [hotelId, bill]);
    for (const role of ["front_desk", "housekeeping", "finance", "read_only"]) {
      const [p] = (await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true returning id::text`,
        [`clp-${role}@fidato.in`, `CLP ${role}`, `test-uid-clp-${role}`])).rows;
      people[role] = p!.id;
      await db.query("delete from staff_hotels where staff_id = $1", [p!.id]);
      await db.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [p!.id, hotelId, role]);
    }
    /* The bill goes to the company on credit: the City ledger's Debit. */
    const sent = await app.request(`/api/hotels/${CODE}/stays/${stay}/payments`, {
      method: "POST",
      headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
      body: JSON.stringify({ method: "Bill to company", amount: 1050, folioId: bill }),
    });
    expect(sent.status, await sent.clone().text()).toBe(200);
  } finally { await db.end(); }
}, 120_000);

afterAll(async () => {
  await closePool();
  const db = await admin();
  try {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    }
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    }
    await db.query("delete from staff_hotels where staff_id = any($1)", [Object.values(people)]);
    await db.query("update staff set is_active = false where id = any($1)", [Object.values(people)]);
    await db.end();
  }
}, 120_000);

describe("recording a company's payment (D27-239)", () => {
  it("is the desk's or the accountant's; not housekeeping's, not the Viewer's", async () => {
    for (const role of ["housekeeping", "read_only"]) {
      expect((await pay(people[role]!, { companyId })).status, role).toBe(403);
    }
    expect(await sql("select 1 from company_payments where hotel_id = $1", [hotelId])).toHaveLength(0);
  });

  it("refuses what is not a payment, and writes nothing", async () => {
    for (const [why, body] of [
      ["no account", {}],
      ["two accounts", { companyId, bookingSourceId: sourceId }],
      ["nothing paid", { companyId, amount: 0 }],
      ["no date", { companyId, receivedOn: undefined }],
      ["after today", { companyId, receivedOn: tomorrow }],
      ["no way of paying", { companyId, method: "barter" }],
    ] as const) {
      const res = await pay(people["front_desk"]!, body);
      expect(res.status, why).toBe(409);
    }
    expect(await sql("select 1 from company_payments where hotel_id = $1", [hotelId])).toHaveLength(0);
  });

  it("is recorded at the desk, and the City ledger opens, credits and closes with it", async () => {
    const res = await pay(people["front_desk"]!, { companyId });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(account(await ledger(today, today), COMPANY))
      .toEqual({ opening: 0, debit: 1050, credit: 300, closing: 750 });
    /* The next day opens on what was left. */
    expect(account(await ledger(tomorrow, tomorrow), COMPANY))
      .toEqual({ opening: 750, debit: 0, credit: 0, closing: 750 });

    /* The Manager report's City Ledger lines, for the day, the same rule. */
    const res2 = await call("dev-owner", `/reports/manager?asOn=${today}`);
    expect(res2.status, await res2.clone().text()).toBe(200);
    const manager = (await res2.json()) as { sections: { key: string; rows: Row[] }[] };
    const city = manager.sections.find((s) => s.key === "city-ledger")!.rows;
    const today_ = (label: string) => city.find((r) => r.cells["label"] === label)!.cells["today"];
    expect(["Opening Balance", "Payment Received", "Charges Raised", "Closing Balance"].map(today_))
      .toEqual([0, 300, 1050, 750]);
  });

  it("takes a booking site's payment too, an account with no company record", async () => {
    const res = await pay(people["finance"]!, { bookingSourceId: sourceId, amount: 500, reference: "OTA remit" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(account(await ledger(today, today), sourceName))
      .toEqual({ opening: 0, debit: 0, credit: 500, closing: -500 });
  });

  it("is a receipt in the accountant's day book, apart from sales (D27-242, Q4)", async () => {
    const res = await call("dev-owner", `/accounting/day-book?from=${today}&to=${today}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const book = (await res.json()) as {
      days: { companyReceipt: number; receipt: number }[];
      total: { companyReceipt: number; receipt: number };
      companyReceipts: { account: string; method: string; reference: string | null; amount: number }[];
    };
    expect(book.days[0]!.companyReceipt).toBe(800);
    expect(book.total.companyReceipt).toBe(800);
    /* Not a guest's receipt, and the bill sent on credit was never one either. */
    expect(book.total.receipt).toBe(0);
    expect(book.companyReceipts.map((r) => [r.account, r.method, r.reference, r.amount]).sort())
      .toEqual([[COMPANY, "Bank transfer", "UTR CLP 1", 300], [sourceName, "Bank transfer", "OTA remit", 500]].sort());
  });
});

describe("a wrong payment line (D27-125)", () => {
  it("is reversed by a line of its own, once, by the accountant and never by the desk", async () => {
    const [line] = await sql<{ id: string }>(
      "select id::text from company_payments where hotel_id = $1 and company_id = $2", [hotelId, companyId]);
    const desk = await call(people["front_desk"]!, `/company-payments/${line!.id}/reverse`, "POST", { reason: "typed twice" });
    expect(desk.status).toBe(403);
    expect((await call(people["finance"]!, `/company-payments/${line!.id}/reverse`, "POST", {})).status).toBe(409);

    const ok = await call(people["finance"]!, `/company-payments/${line!.id}/reverse`, "POST", { reason: "typed twice" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const again = await call(people["finance"]!, `/company-payments/${line!.id}/reverse`, "POST", { reason: "again" });
    expect(again.status).toBe(409);
    expect(account(await ledger(today, today), COMPANY))
      .toEqual({ opening: 0, debit: 1050, credit: 0, closing: 1050 });
    /* A reversed receipt leaves the day book too. */
    const book = (await (await call("dev-owner", `/accounting/day-book?from=${today}&to=${today}`)).json()) as
      { total: { companyReceipt: number }; companyReceipts: unknown[] };
    expect([book.total.companyReceipt, book.companyReceipts.length]).toEqual([500, 1]);

    const list = (await (await call(people["finance"]!, "/company-payments")).json()) as
      { payments: { id: string; reversed: boolean; reversesId: string | null }[] };
    expect(list.payments.find((p) => p.id === line!.id)!.reversed).toBe(true);
    expect(list.payments.some((p) => p.reversesId === line!.id)).toBe(true);
  });

  it("is never edited or deleted, even from the app's own connection", async () => {
    const [line] = await sql<{ id: string }>(
      "select id::text from company_payments where hotel_id = $1 limit 1", [hotelId]);
    await expect(withUser(people["finance"]!, (c) =>
      c.query("update company_payments set amount = 1 where id = $1", [line!.id]))).rejects.toThrow();
    await expect(withUser(people["finance"]!, (c) =>
      c.query("delete from company_payments where id = $1", [line!.id]))).rejects.toThrow();
  });
});
