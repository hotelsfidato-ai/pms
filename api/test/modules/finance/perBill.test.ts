import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, type Client } from "../../../src/db.ts";
import { folioBalance, issueFolioInvoice, postFolioCharge } from "../../../src/modules/finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE BILL AT A TIME - QA FI-1, FI-2, FI-7 (28 September)

   A stay whose bill was split: the guest's coffee on the guest's bill, the
   room on a company's. The tax invoice went to the booking's company with
   the guest's coffee on it and the room on no invoice (FI-1); Settle on the
   company's bill paid the guest's (FI-2); and after a credit note the stay
   could not be invoiced again (FI-7). Everything is per bill now, through
   the doors a banquet function's bill uses too (round E).

   Its own property (PBL), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "PBL";
let hotelId = "";
let stayId = "";
let guestBill = "";
let companyBill = "";
let otherStayBill = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const post = (text: string, folio: string, amount: number) => sql(
  `insert into folio_postings (hotel_id, folio_id, business_date, category,
                               description, amount, tax_rate, tax_amount)
   values ($1, $2, app.business_date($1), $3, $3 || ' line', $4, 5, round($4 * 0.05, 2))`,
  [hotelId, folio, text, amount]);

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Per Bill Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query("update hotels set gstin = '27AAAAA0000A1Z5', state = 'MH' where id = $1", [hotelId]);
    const company = (await db.query<{ id: string }>(
      /* Credit allowed: its bill is sent to it on credit below (D27-184, C-9). */
      `insert into companies (name, gstin, address_line, city, credit_allowed)
       values ('Per Bill Travels', '27BBBBB1111B1Z5', '12 MG Road', 'Pune', true) returning id::text`,
    )).rows[0]!.id;
    const guest = (await db.query<{ id: string }>(
      "insert into guests (full_name) values ('Per Bill Guest') returning id::text")).rows[0]!.id;
    const stay = async () => (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, company_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2,
               (select id from room_types where hotel_id = $1 and code = 'STD'), $3,
               app.business_date($1), app.business_date($1) + 1, 6000, 'confirmed')
       returning id::text`, [hotelId, guest, company])).rows[0]!.id;
    stayId = await stay();
    const other = await stay();
    const folio = async (reservation: string, billTo: string, co: string | null) =>
      (await db.query<{ id: string }>(
        `insert into folios (hotel_id, reservation_id, bill_to, company_id, opened_at)
         values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval) returning id::text`,
        [hotelId, reservation, billTo, co, billTo === "guest" ? "0" : "1"])).rows[0]!.id;
    guestBill = await folio(stayId, "guest", null);
    companyBill = await folio(stayId, "company", company);
    otherStayBill = await folio(other, "guest", null);
  } finally { await db.end(); }
  await post("food", guestBill, 150);        // ₹157.50 on the guest's bill
  await post("room", companyBill, 6000);     // ₹6,300 on the company's
});

afterAll(async () => {
  /* The app's pool first: an ALTER TABLE waits on every open connection. */
  await closePool();
  const db = await admin();
  try {
    for (const t of ["folio_postings folio_postings_append_only", "invoices invoices_immutable",
                     "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    }
    await db.query("delete from invoices where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of ["folio_postings folio_postings_append_only", "invoices invoices_immutable",
                     "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    }
    await db.end();
  }
}, 120_000);

describe("a split stay's tax invoices (FI-1, FI-7)", () => {
  it("refuses to guess which bill", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/invoice`, "POST", {});
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.reason).toMatch(/split/);
  });

  it("invoices the guest's bill to the guest, with the guest's lines only", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/invoice`, "POST", { folioId: guestBill });
    const body = await res.json() as { ok: boolean; recipient: string; total: number; number: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.recipient).toBe("Per Bill Guest");
    expect(body.total).toBe(157.5);
    const [row] = await sql<{ recipient_gstin: string | null }>(
      "select recipient_gstin from invoices where number = $1", [body.number]);
    expect(row!.recipient_gstin, "the company's GSTIN on the guest's invoice").toBeNull();
  });

  it("invoices the company's bill to the company: its GSTIN, its address, the room", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/invoice`, "POST", { folioId: companyBill });
    const body = await res.json() as { ok: boolean; recipient: string; total: number; number: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.recipient).toBe("Per Bill Travels");
    expect(body.total).toBe(6300);
    const [row] = await sql<{ recipient_gstin: string; recipient_address: string }>(
      "select recipient_gstin, recipient_address from invoices where number = $1", [body.number]);
    expect(row).toEqual({ recipient_gstin: "27BBBBB1111B1Z5", recipient_address: "12 MG Road, Pune" });
  });

  it("refuses a bill from another stay", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/invoice`, "POST", { folioId: otherStayBill });
    expect(res.status).toBe(409);
  });

  it("issues the guest's bill again after its credit note", async () => {
    const [first] = await sql<{ number: string }>(
      "select number from invoices where folio_id = $1 and credits_id is null", [guestBill]);
    const credit = await call(`/${CODE}/invoices/${first!.number}/credit-note`, "POST",
      { reason: "Wrong name on it" });
    expect(credit.status, await credit.clone().text()).toBe(200);
    const again = await call(`/${CODE}/stays/${stayId}/invoice`, "POST", { folioId: guestBill });
    const body = await again.json() as { ok: boolean; number: string; duplicate?: boolean };
    expect(again.status, JSON.stringify(body)).toBe(200);
    expect(body.duplicate).toBeUndefined();
    expect(body.number).not.toBe(first!.number);
  });
});

describe("a payment on a split stay (FI-2)", () => {
  it("lands on the bill it was taken on", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/payments`, "POST",
      { method: "Bill to company", amount: 6300, folioId: companyBill });
    const body = await res.json() as { ok: boolean; data: { id: string } };
    expect(res.status, JSON.stringify(body)).toBe(200);
    const [line] = await sql<{ folio_id: string }>(
      "select folio_id::text from folio_postings where id = $1", [body.data.id]);
    expect(line!.folio_id, "it paid the guest's bill").toBe(companyBill);
  });

  it("is held to THAT bill's balance, not the stay's", async () => {
    /* The company's bill is paid; the guest's owes ₹157.50. */
    const res = await call(`/${CODE}/stays/${stayId}/payments`, "POST",
      { method: "UPI", amount: 157.5, folioId: companyBill });
    const body = await res.json() as { ok: boolean; needs?: string };
    expect(res.status).toBe(409);
    expect(body.needs).toBe("credit");
  });

  it("refuses a bill from another stay", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/payments`, "POST",
      { method: "UPI", amount: 10, folioId: otherStayBill, heldAsCredit: true });
    expect(res.status).toBe(409);
  });
});

describe("the per-bill door (round E)", () => {
  it("folioBalance answers one bill's figures, and null for a bill with nothing on it", async () => {
    const db = await admin();
    const client = await db.connect();
    try {
      expect(await folioBalance(client as unknown as Client, companyBill))
        .toEqual({ charges: 6000, tax: 300, paid: 6300, balance: 0 });
      expect(await folioBalance(client as unknown as Client, otherStayBill)).toBeNull();
    } finally { client.release(); await db.end(); }
  });

  it("postFolioCharge posts onto that bill, under the same GST refusal as the desk's", async () => {
    const db = await admin();
    const client = await db.connect();
    const charge = { description: "Hall hire", amount: 2000, category: "Miscellaneous" };
    try {
      const refused = await postFolioCharge(client as unknown as Client, hotelId, companyBill, charge);
      expect(refused).toMatchObject({ ok: false });
      expect(!refused.ok && refused.reason).toMatch(/no GST rule for room/);
      const rule = await call(`/${CODE}/tax/room`, "PUT", { slabs: [{ overAmount: 0, rate: 5 }] });
      expect(rule.status, await rule.clone().text()).toBe(200);
      const made = await postFolioCharge(client as unknown as Client, hotelId, companyBill, charge);
      expect(made.ok, JSON.stringify(made)).toBe(true);
      const [line] = await sql<{ folio_id: string; tax_amount: string }>(
        "select folio_id::text, tax_amount::text from folio_postings where id = $1",
        [made.ok ? made.id : "0"]);
      expect(line).toEqual({ folio_id: companyBill, tax_amount: "100.00" });
    } finally { client.release(); await db.end(); }
  });

  it("issueFolioInvoice takes a SAC of the caller's choosing", async () => {
    await post("misc", otherStayBill, 1000);
    const db = await admin();
    const client = await db.connect();
    try {
      await client.query("select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), false)");
      const made = await issueFolioInvoice(client as unknown as Client, hotelId, otherStayBill,
        { name: "A function's host", gstin: null, address: null }, "997212");
      expect(made.ok, JSON.stringify(made)).toBe(true);
      const [row] = await sql<{ sac_code: string }>(
        "select sac_code from invoices where folio_id = $1", [otherStayBill]);
      expect(row!.sac_code).toBe("997212");
    } finally { client.release(); await db.end(); }
  });
});
