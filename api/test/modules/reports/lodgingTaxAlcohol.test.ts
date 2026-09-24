import { describe, it, expect } from "vitest";
import { buildReport, type ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LODGING TAX SHEET, AND A BILL WITH ALCOHOL ON IT

   D22-45, the owner: "Take alcohol and its VAT out" of Other Bills. The
   sheet's bill numbers come from the GST invoice, which carries no
   alcohol (D21-91); Other Bills summed every non-room line on the folio,
   VAT line included, so a bar tab landed on a GST return.

   And D22-9: a property made today has no GST rate, so the sheet's
   CGST/SGST heading says "-", never "0%" or an invented 2.5%.

   Built in one transaction that is rolled back: its own property, a
   bill with a room, a meal and a drink on it, and the invoice issued for
   it. Nothing is left behind - an invoice cannot be deleted otherwise.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

describe("the lodging tax sheet, with alcohol on the bill", () => {
  it("leaves alcohol and its VAT out of Other Bills, and heads an unset rate with a dash", async () => {
    const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
    const client = await pool.connect();
    let doc: ReportDoc;
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true)`);
      const h = (await client.query<{ id: string }>(
        "select app.provision_property_unchecked('LTX','Lodging Tax Test','Nowhere')::text as id")).rows[0]!.id;
      await client.query("insert into guests (full_name) values ('Lodging tax test guest')");
      const folio = (await client.query<{ id: string }>(
        `with r as (
           insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                     check_in, check_out, agreed_rate, status)
           values ($1, app.next_reference($1),
                   (select id from guests where full_name = 'Lodging tax test guest' limit 1),
                   (select id from room_types where hotel_id = $1 and code = 'STD'),
                   app.business_date($1), app.business_date($1) + 1, 2000, 'checked_in')
           returning id)
         insert into folios (hotel_id, reservation_id, status)
         select $1, r.id, 'open' from r returning id::text`, [h])).rows[0]!.id;

      /* A room, a meal under GST, and a drink under VAT. */
      await client.query(
        `insert into folio_postings (hotel_id, folio_id, business_date, category,
                                     description, amount, tax_rate, tax_amount, tax_scheme)
         values ($1, $2, app.business_date($1), 'room',     'Room',   2000,  5, 100, 'gst'),
                ($1, $2, app.business_date($1), 'food',     'Dinner', 1000,  5,  50, 'gst'),
                ($1, $2, app.business_date($1), 'beverage', 'Whisky',  500, 10,  50, 'vat')`,
        [h, folio]);
      /* The GST invoice for it: the GST lines only, as issuing writes it. */
      await client.query(
        `insert into invoices (hotel_id, folio_id, fin_year, number, total, tax_total,
                               taxable_value, cgst_total, sgst_total, business_date, sac_code)
         values ($1, $2, '2026-27', 'LTX-TEST-1', 3150, 150, 3000, 75, 75, '2026-07-15', '996311')`,
        [h, folio]);

      doc = await buildReport(client, h, "lodging-tax", { asOn: "2026-07-31", month: "2026-07" });
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }

    const band = doc.sections[0]!;
    const day = band.rows.find((r) => r.cells["date"] === "2026-07-15");
    expect(day, JSON.stringify(band.rows)).toBeDefined();
    expect(day!.cells["totalBill"]).toBe(3150);
    expect(day!.cells["roomRent"]).toBe(2000);
    /* The dinner and its GST - not the whisky, and not its VAT (1600). */
    expect(day!.cells["otherBills"]).toBe(1050);

    expect(band.columns.find((c) => c.group?.startsWith("CGST"))!.group).toBe("CGST @-");
    expect(band.columns.find((c) => c.group?.startsWith("SGST"))!.group).toBe("SGST @-");
  });
});
