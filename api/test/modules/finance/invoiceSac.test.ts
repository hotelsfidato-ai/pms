import { describe, it, expect, afterAll } from "vitest";
import { withSession } from "../../../src/auth.ts";
import { closePool } from "../../../src/db.ts";
import { postCharge, issueFolioInvoice, invoiceFacts } from "../../../src/modules/finance/index.ts";
import { sacOf } from "../../../src/modules/finance/invoices.ts";

/* ══════════════════════════════════════════════════════════════════
   A SAC ON EACH INVOICE LINE (the owner's D27-258 Q6; the master's yes)

   A posting keeps the tax kind postCharge taxed it under; the invoice
   keeps each kind's SAC as it was when issued, frozen with the rest; each
   line prints its kind's. A room line with none is the invoice's 996311;
   anything else with none is a dash. Run in the owner's session and ROLLED
   BACK (MEMORY 292): the demo is left as it was.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};
afterAll(async () => { await closePool(); });

type Facts = { number: string; sacCode: string; lines: { description: string; sac: string | null }[] };

describe("a SAC on each invoice line", () => {
  it("keeps the bar's and the restaurant's own kinds, and the codes the invoice was issued with", async () => {
    const { rows } = await sql(
      `select r.id::text as stay, h.id::text as hotel, f.id::text as folio
         from reservations r join hotels h on h.id = r.hotel_id join folios f on f.reservation_id = r.id
        where h.code = '5EL' and r.status = 'checked_in'
          /* None of the stay's bills invoiced: an earlier file can leave a
             stay with two, and the charges below go to postCharge's own. */
          and not exists (select 1 from invoices i join folios f2 on f2.id = i.folio_id
                           where f2.reservation_id = r.id)
        limit 1`);
    const stay = rows[0] as { stay: string; hotel: string; folio: string } | undefined;
    expect(stay, "the demo has an in-house stay with no invoice yet").toBeTruthy();

    const out = await withSession("dev-owner", async (client) => {
      try {
        for (const kind of ["bar", "restaurant"]) {
          await client.query(
            `insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, $2, 0, 5) on conflict do nothing`,
            [stay!.hotel, kind]);
        }
        await client.query("delete from tax_sac where hotel_id = $1", [stay!.hotel]);
        await client.query(
          `insert into tax_sac (hotel_id, kind, sac_code) values ($1, 'restaurant', '996331'), ($1, 'bar', '996332')`,
          [stay!.hotel]);

        const bar = await postCharge(client, stay!.hotel, stay!.stay,
          { description: "SAC test: a drink at the bar", amount: 300, category: "Beverage", taxKind: "bar" });
        const food = await postCharge(client, stay!.hotel, stay!.stay,
          { description: "SAC test: dinner", amount: 800, category: "Food", taxKind: "restaurant" });
        const kinds = (await client.query<{ tax_kind: string }>(
          "select tax_kind from folio_postings where id = any($1::bigint[]) order by amount",
          [[(bar as { id: string }).id, (food as { id: string }).id]])).rows.map((r) => r.tax_kind);

        /* The bill the charges went to, not whichever the select above met
           first (the release-18 gates, 2 November: it invoiced an empty one). */
        const folio = (await client.query<{ f: string }>(
          "select folio_id::text as f from folio_postings where id = $1", [(bar as { id: string }).id])).rows[0]!.f;
        const issued = await issueFolioInvoice(client, stay!.hotel, folio,
          { name: "SAC Test Guest", gstin: null, address: null });
        expect(issued, JSON.stringify(issued)).toMatchObject({ ok: true });
        const number = (issued as { number: string }).number;
        const before = (await invoiceFacts(client, stay!.hotel, number)) as Facts;

        /* The hotel changes its codes after the invoice: the invoice does not. */
        await client.query("update tax_sac set sac_code = '999999' where hotel_id = $1", [stay!.hotel]);
        const after = (await invoiceFacts(client, stay!.hotel, number)) as Facts;
        return { kinds, before, after };
      } finally {
        await client.query("rollback");
      }
    });

    expect(out.kinds, "postCharge keeps the kind it taxed by").toEqual(["bar", "restaurant"]);
    const sacOfLine = (f: Facts, d: string) => f.lines.find((l) => l.description === d)?.sac;
    expect(sacOfLine(out.before, "SAC test: a drink at the bar")).toBe("996332");
    expect(sacOfLine(out.before, "SAC test: dinner")).toBe("996331");
    expect(sacOfLine(out.after, "SAC test: dinner"), "frozen as issued").toBe("996331");
    expect(out.after.sacCode).toBe("996311");
  });

  it("prints 996311 on a room line and a dash on the rest of an invoice issued before", () => {
    expect(sacOf("room", null, "996311")).toBe("996311");
    expect(sacOf("restaurant", null, "996311")).toBeNull();
    expect(sacOf(null, null, "996311"), "a line whose kind is not known").toBeNull();
    expect(sacOf("room", {}, "996311"), "rooms unsaid: the invoice's own").toBe("996311");
  });
});
