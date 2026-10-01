import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { withSession } from "../../../src/auth.ts";
import { closePool } from "../../../src/db.ts";
import { postCharge } from "../../../src/modules/finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BILL AS IT STANDS — app.stay_bill, migration 123 (D21-10)

   The desk's printed bill used to add itself up in the browser, and on
   21 September it was found printing the demo's made-up GSTIN at every
   hotel, "CGST 2.5% / SGST 2.5%" whatever the lines were taxed at, and a
   corrected charge taken off the net twice. These prove the one definition
   that replaced it says what the ledger and the hotel's own record say.

   Everything here runs in the owner's session and is ROLLED BACK, so the
   demo property is left exactly as it was (MEMORY 292). The stay's existing
   lines are read first and every check is on what this file adds.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

afterAll(async () => { await closePool(); });

type Bill = {
  hotel: { name: string; gstin: string | null };
  lines: { description: string; amount: number; rate: number | null }[];
  taxes: { rate: number; taxable: number; cgst: number; sgst: number }[];
  net: number; tax: number; total: number; rounded: number; roundOff: number;
  paid: number; balance: number;
};

async function aStayInHouse() {
  const { rows } = await sql(
    `select r.id::text as stay, h.id::text as hotel
       from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'checked_in'
      limit 1`);
  return rows[0] as { stay: string; hotel: string } | undefined;
}

const TEST_GSTIN = "27TESTB1234F1Z5";

describe("the bill as it stands", () => {
  it("prints the hotel's own GSTIN, each line's own rate, and cancels a correction on both sides", async () => {
    const stay = await aStayInHouse();
    expect(stay, "the demo has an in-house stay").toBeTruthy();

    const out = await withSession("dev-owner", async (client) => {
      try {
        const read = async () =>
          (await client.query<{ bill: Bill }>("select app.stay_bill($1) as bill", [stay!.stay])).rows[0]!.bill;
        const before = await read();

        /* The hotel's own number, and two rates this file sets itself. */
        await client.query("update hotels set gstin = $2 where id = $1", [stay!.hotel, TEST_GSTIN]);
        await client.query(
          `insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 5)
           on conflict (hotel_id, kind, over_amount) do update set rate = 5`, [stay!.hotel]);
        await client.query(
          `insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'spa', 0, 18)
           on conflict (hotel_id, kind, over_amount) do update set rate = 18`, [stay!.hotel]);

        const laundry = await postCharge(client, stay!.hotel, stay!.stay,
          { description: "Stay bill test: laundry", amount: 1000, category: "Laundry" });
        const spa = await postCharge(client, stay!.hotel, stay!.stay,
          { description: "Stay bill test: spa", amount: 2000, category: "Spa", taxKind: "spa" });
        const wrong = await postCharge(client, stay!.hotel, stay!.stay,
          { description: "Stay bill test: posted in error", amount: 500, category: "Laundry" });
        expect([laundry.ok, spa.ok, wrong.ok]).toEqual([true, true, true]);

        /* The correction: its own line, pointing at the one it reverses. */
        await client.query(
          `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                       amount, tax_rate, tax_amount, reverses_id, reservation_id)
           select hotel_id, folio_id, business_date, category, 'Reversal: ' || description,
                  -amount, tax_rate, -tax_amount, id, reservation_id
             from folio_postings where id = $1`, [(wrong as { id: string }).id]);

        /* A payment of 300. */
        await client.query(
          `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                       amount, tax_amount, reservation_id)
           select hotel_id, folio_id, business_date, 'payment', 'Stay bill test: cash',
                  -300, 0, reservation_id
             from folio_postings where id = $1`, [(laundry as { id: string }).id]);

        return { before, after: await read() };
      } finally {
        await client.query("rollback");
      }
    });

    const { before, after } = out;
    const rateRow = (b: Bill, rate: number) =>
      b.taxes.find((t) => Number(t.rate) === rate) ?? { taxable: 0, cgst: 0, sgst: 0 };

    /* The hotel's own number, never the demo's. */
    expect(after.hotel.gstin).toBe(TEST_GSTIN);
    expect(JSON.stringify(after)).not.toContain("27AAAAA0000A1Z5");

    /* Two lines more: the corrected charge and its correction are both gone,
       and the payment is not a line of the bill. */
    expect(after.lines.length - before.lines.length).toBe(2);
    expect(after.lines.map((l) => l.description)).not.toContain("Stay bill test: posted in error");
    expect(Number(after.net) - Number(before.net)).toBeCloseTo(3000, 2);

    /* Each rate its own CGST/SGST pair, each half of that rate's tax. */
    const five = rateRow(after, 5), fivePrev = rateRow(before, 5);
    expect(Number(five.taxable) - Number(fivePrev.taxable)).toBeCloseTo(1000, 2);
    const eighteen = rateRow(after, 18), eighteenPrev = rateRow(before, 18);
    expect(Number(eighteen.taxable) - Number(eighteenPrev.taxable)).toBeCloseTo(2000, 2);
    expect((Number(eighteen.cgst) + Number(eighteen.sgst))
         - (Number(eighteenPrev.cgst) + Number(eighteenPrev.sgst))).toBeCloseTo(360, 2);
    expect(Number(eighteen.cgst)).toBeCloseTo(Number(eighteen.sgst), 2);

    /* What was paid, and what is left: the ledger's own balance. */
    expect(Number(after.paid) - Number(before.paid)).toBeCloseTo(300, 2);
    expect(Number(after.balance)).toBeCloseTo(Number(after.total) - Number(after.paid), 2);
    expect(Number(after.rounded)).toBe(Math.round(Number(after.total)));
  });

  it("answers the owner, and refuses somebody not rostered at the hotel", async () => {
    const stay = await aStayInHouse();
    const owner = await app.request(`/api/hotels/5EL/stays/${stay!.stay}/bill`,
      { headers: { "x-dev-staff-id": "dev-owner" } });
    expect(owner.status, await owner.clone().text()).toBe(200);

    /* NOT "dev-agra": despite the name, the Agra clerk is rostered at 5EL
       in the demo data too, and was rightly let in. The Pune clerk is not. */
    const { rows } = await sql(
      `select count(*)::int as n from staff_hotels sh join staff s on s.id = sh.staff_id
        join hotels h on h.id = sh.hotel_id
       where s.firebase_uid = 'dev-pune' and h.code = '5EL'`);
    expect(rows[0].n, "the Pune clerk holds no role at 5EL").toBe(0);
    const outsider = await app.request(`/api/hotels/5EL/stays/${stay!.stay}/bill`,
      { headers: { "x-dev-staff-id": "dev-pune" } });
    expect(outsider.status).toBe(404);
  });

  /* D27-200: the bill is drawn in sections, Bar by its VAT. Every line says
     what it was billed under - on the bill (app.stay_bill, 166) and on the
     Bill tab's own read - or a VAT line and a GST line at one rate look alike. */
  it("says each line's tax scheme, on the bill and on the Bill tab's lines", async () => {
    /* A stay with a charge on its bill (the first guest in house may have none). */
    const { rows } = await sql(
      `select r.id::text as stay
         from reservations r join hotels h on h.id = r.hotel_id
         join folios f on f.reservation_id = r.id
         join folio_postings fp on fp.folio_id = f.id
        where h.code = '5EL' and fp.category = 'room' and fp.reverses_id is null
          and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)
        limit 1`);
    const stay = rows[0] as { stay: string } | undefined;
    const headers = { "x-dev-staff-id": "dev-owner" };
    const bill = (await (await app.request(`/api/hotels/5EL/stays/${stay!.stay}/bill`, { headers }))
      .json()) as { lines: { scheme?: string }[] };
    expect(bill.lines.length).toBeGreaterThan(0);
    expect(bill.lines.map((l) => l.scheme).every((x) => x === "gst" || x === "vat")).toBe(true);

    const lines = (await (await app.request(`/api/hotels/5EL/stays/${stay!.stay}/postings`, { headers }))
      .json()) as { scheme?: string; rate?: number | null }[];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => (l.scheme === "gst" || l.scheme === "vat") && "rate" in l)).toBe(true);
  });
});
