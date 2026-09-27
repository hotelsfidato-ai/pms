import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { noGstin } from "../../../src/modules/finance/invoices.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO THE INVOICE IS FROM, AND WHO IT IS TO (28 September, the release review)

   A company's invoice printed the GUEST's home address under the
   company's name (CGST Rule 46(e)); and a property with no GSTIN issued
   tax invoices and credit notes with "-" where the supplier's GSTIN goes.
   Now the company's address, and no GSTIN is a refusal before the number
   is taken. Demo stays, as invoices.test.ts does.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";
let companyId = "";
const moved: string[] = [];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const post = (path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A demo stay with GST charges and no invoice yet (invoices.test.ts's). */
const invoiceable = async () => (await sql<{ id: string }>(
  `select r.id::text from reservations r
     join folios f on f.reservation_id = r.id
     join folio_postings fp on fp.folio_id = f.id
    where r.hotel_id = (select id from hotels where code = '5EL')
      and r.company_id is null
      and fp.category not in ('payment','refund') and fp.tax_scheme = 'gst'
      and not exists (select 1 from invoices i where i.folio_id = f.id)
    group by r.id having sum(fp.amount) > 0
    limit 1`))[0]!.id;

const nextNumber = async () => (await sql<{ n: string }>(
  `select next_number::text as n from invoice_series
    where hotel_id = (select id from hotels where code = '5EL')
    order by fin_year desc limit 1`))[0]?.n ?? null;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  companyId = (await sql<{ id: string }>(
    `insert into companies (name, gstin, address_line, city)
     values ('RECIPTEST Travels', '27ABCDE1234F1Z5', '12 MG Road', 'Pune') returning id::text`))[0]!.id;
});

afterAll(async () => {
  await sql("update reservations set company_id = null where id = any($1::uuid[])", [moved]);
  await sql("delete from companies where id = $1", [companyId]).catch(() => undefined);
  await closePool();
});

describe("a company's tax invoice", () => {
  it("prints the company's address, not the guest's", async () => {
    const stay = await invoiceable();
    moved.push(stay);
    await sql("update reservations set company_id = $2 where id = $1", [stay, companyId]);

    const res = await post(`/stays/${stay}/invoice`);
    expect(res.status, await res.clone().text()).toBe(200);
    const [inv] = await sql<{ recipient_name: string; recipient_address: string | null }>(
      "select recipient_name, recipient_address from invoices where number = $1",
      [((await res.json()) as { number: string }).number]);
    expect(inv).toEqual({ recipient_name: "RECIPTEST Travels", recipient_address: "12 MG Road, Pune" });
  });
});

describe("a property with no GSTIN", () => {
  it("issues no tax invoice and no credit note, and takes no number", async () => {
    const stay = await invoiceable();
    const [issued] = await sql<{ number: string }>(
      `select i.number from invoices i join folios f on f.id = i.folio_id
        where f.reservation_id = $1`, [moved[0]]);
    const [was] = await sql<{ gstin: string | null }>("select gstin from hotels where code = '5EL'");
    await sql("update hotels set gstin = null where code = '5EL'");
    try {
      const before = await nextNumber();

      const inv = await post(`/stays/${stay}/invoice`);
      expect(inv.status).toBe(409);
      expect(((await inv.json()) as { reason: string }).reason).toBe(
        "This property has no GSTIN, and a tax invoice must carry one. Enter it on the "
        + "Properties screen, then issue the invoice.");

      const note = await post(`/invoices/${encodeURIComponent(issued!.number)}/credit-note`,
        { reason: "Wrong company" });
      expect(note.status).toBe(409);
      expect(((await note.json()) as { reason: string }).reason)
        .toBe(noGstin("a credit note", "the credit note"));

      expect(await nextNumber()).toBe(before);
    } finally {
      await sql("update hotels set gstin = $1 where code = '5EL'", [was!.gstin]);
    }
  });
});
