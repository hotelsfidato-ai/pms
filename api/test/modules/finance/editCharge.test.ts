import { describe, it, expect, afterAll } from "vitest";
import { withSession } from "../../../src/auth.ts";
import { closePool } from "../../../src/db.ts";
import type { Client } from "../../../src/db.ts";
import { issueFolioInvoice, postCharge, takeFolioPayment } from "../../../src/modules/finance/index.ts";
import { changeStayRate, editFolioCharge, reverseFolioCharge } from "../../../src/modules/finance/postings.ts";

/* ══════════════════════════════════════════════════════════════════
   EDITING A CHARGE, AND THE BILL ONCE A TAX INVOICE STANDS
   (the owner's D27-157 and D27-162)

   Edit is the old line reversed, with its reason, and the corrected one
   posted - one step. A room night's tax follows the slab on its price PER
   NIGHT (5% up to ₹7,500, 18% above at the demo's 5 Elements). Once a tax
   invoice stands, a charge is corrected only by a credit note - by Edit or
   by ↺ - while a payment's reversal stays possible (D27-125).

   Every case runs in the owner's session and is rolled back.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

afterAll(async () => { await closePool(); });

const attempt = <T>(fn: (client: Client) => Promise<T>) =>
  withSession("dev-owner", async (client) => {
    try { return await fn(client); } finally { await client.query("rollback"); }
  });

async function aStayInHouse() {
  const { rows } = await sql(
    `select r.id::text as stay, h.id::text as hotel
       from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'checked_in'
      order by r.reference limit 1`);
  return rows[0] as { stay: string; hotel: string };
}

const line = async (client: Client, id: string) => (await client.query<{
  amount: string; tax_rate: string; tax_amount: string; description: string;
  category: string; business_date: string;
}>(
  `select amount::text, tax_rate::text, tax_amount::text, description, category,
          business_date::text
     from folio_postings where id = $1::bigint`, [id])).rows[0]!;

/** A charge posted by the desk's own door, for the case to edit. */
async function posted(client: Client, stay: { stay: string; hotel: string },
  description: string, amount: number, category = "Room") {
  const out = await postCharge(client, stay.hotel, stay.stay, { description, amount, category });
  if (!out.ok) throw new Error(out.reason);
  return out.id;
}

describe("editing a charge (D27-157)", () => {
  it("reverses the old line with the reason and posts the new one, a room night's tax by the slab per night", async () => {
    const stay = await aStayInHouse();
    const out = await attempt(async (client) => {
      const one = await posted(client, stay, "Room 205 · 1 night", 7000);
      const two = await posted(client, stay, "Room 205 · 2 nights", 14000);
      const e1 = await editFolioCharge(client, stay.hotel, one,
        { amount: 8000, reason: "Agreed at 8,000" }, { reservationId: stay.stay });
      const e2 = await editFolioCharge(client, stay.hotel, two,
        { amount: 15000, reason: "Two nights at 7,500" }, { reservationId: stay.stay });
      if (!e1.ok || !e2.ok) throw new Error(JSON.stringify([e1, e2]));
      const { rows: rev } = await client.query<{ description: string; amount: string }>(
        "select description, amount::text from folio_postings where reverses_id = $1::bigint", [one]);
      return { e1: await line(client, e1.id), e2: await line(client, e2.id), rev: rev[0] };
    });

    expect(out.e1, "₹8,000 a night is above ₹7,500").toMatchObject(
      { amount: "8000.00", tax_rate: "18.00", tax_amount: "1440.00", category: "room",
        description: "Room 205 · 1 night" });
    expect(out.e2.tax_rate, "₹15,000 for two nights is ₹7,500 a night: 5%").toBe("5.00");
    expect(out.rev, "the old line reversed, the reason on it").toEqual(
      { description: "Reversal - Room 205 · 1 night (why: Agreed at 8,000)", amount: "-7000.00" });
  });

  it("refuses a room night's words and a price of nothing", async () => {
    /* A line on a closed day is refused by the reversal Edit goes through;
       asked at Pune, where a day is closed: night-audit/corrections.test.ts. */
    const stay = await aStayInHouse();
    const out = await attempt(async (client) => {
      const id = await posted(client, stay, "Room 205 · 1 night", 7000);
      const words = await editFolioCharge(client, stay.hotel, id,
        { description: "Suite upgrade", reason: "x" }, { reservationId: stay.stay });
      const zero = await editFolioCharge(client, stay.hotel, id,
        { amount: 0, reason: "x" }, { reservationId: stay.stay });
      return [words, zero].map((r) => (r.ok ? "posted" : r.reason));
    });
    expect(out).toEqual([
      "A room night's words count its nights. Change its price only.",
      "A charge is more than zero. To take it off the bill, reverse it.",
    ]);
  });
});

describe("once a tax invoice stands (D27-162)", () => {
  it("a charge is refused by ↺ and by Edit; a payment is still reversed", async () => {
    const stay = await aStayInHouse();
    const out = await attempt(async (client) => {
      const charge = await posted(client, stay, "Laundry · 2 shirts", 200, "Laundry");
      const { rows } = await client.query<{ folio: string }>(
        "select folio_id::text as folio from folio_postings where id = $1::bigint", [charge]);
      const folio = rows[0]!.folio;
      const paid = await takeFolioPayment(client, stay.hotel, folio,
        { method: "UPI", amount: 100 }, { locks: [], cashTaken: async () => 0, foreign: false });
      if (!paid.ok) throw new Error(paid.reason);
      const invoice = await issueFolioInvoice(client, stay.hotel, folio,
        { name: "Invoice Test", gstin: null, address: null });
      if (!invoice.ok) throw new Error(JSON.stringify(invoice));

      const reverse = await reverseFolioCharge(client, stay.hotel, charge, "Wrong room",
        { reservationId: stay.stay });
      const edit = await editFolioCharge(client, stay.hotel, charge,
        { amount: 150, reason: "One shirt" }, { reservationId: stay.stay });
      const payment = await reverseFolioCharge(client, stay.hotel, paid.id, "UPI bounced",
        { reservationId: stay.stay });
      return { reverse, edit, payment: payment.ok, number: (invoice as { number: string }).number };
    });

    const refusal = `This bill has tax invoice ${out.number}. Only a credit note corrects it now.`;
    expect(out.reverse).toEqual({ ok: false, reason: refusal });
    expect(out.edit).toEqual({ ok: false, reason: refusal });
    expect(out.payment, "a payment is on no invoice (D27-125)").toBe(true);
  });
});

describe("changing the rate (D27-162)", () => {
  it("corrects a night charged today to the new rate, and changes nothing when one night cannot be", async () => {
    const stay = await aStayInHouse();
    const rateOf = async (client: Client) => (await client.query<{ rate: string }>(
      "select agreed_rate::text as rate from reservations where id = $1", [stay.stay])).rows[0]!.rate;
    const live = async (client: Client) => (await client.query<{ amount: string; tax_rate: string }>(
      `select amount::text, tax_rate::text from folio_postings fp
        where fp.reservation_id = $1 and fp.category = 'room' and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)
        order by fp.id`, [stay.stay])).rows;

    const changed = await attempt(async (client) => {
      const out = await changeStayRate(client, stay.hotel, stay.stay, 8000, "Corporate rate");
      return { out, rate: await rateOf(client), lines: await live(client) };
    });
    expect(changed.out.ok, JSON.stringify(changed.out)).toBe(true);
    expect(changed.rate).toBe("8000.00");
    expect(changed.lines.length, "the demo's night charged today").toBeGreaterThan(0);
    for (const l of changed.lines) expect(l.tax_rate, "₹8,000 a night").toBe("18.00");

    const refused = await attempt(async (client) => {
      const before = await rateOf(client);
      const { rows } = await client.query<{ folio: string }>(
        `select folio_id::text as folio from folio_postings
          where reservation_id = $1 and category = 'room' limit 1`, [stay.stay]);
      const invoice = await issueFolioInvoice(client, stay.hotel, rows[0]!.folio,
        { name: "Invoice Test", gstin: null, address: null });
      if (!invoice.ok) throw new Error(JSON.stringify(invoice));
      const out = await changeStayRate(client, stay.hotel, stay.stay, 8000, "Corporate rate");
      return { out, before, after: await rateOf(client), number: (invoice as { number: string }).number };
    });
    expect(refused.out.ok).toBe(false);
    expect((refused.out as { reason: string }).reason).toMatch(
      new RegExp(`^Nothing changed\\. The night of .+: This bill has tax invoice ${refused.number}\\.`));
    expect(refused.after, "the rate stays with the nights").toBe(refused.before);
  });
});
