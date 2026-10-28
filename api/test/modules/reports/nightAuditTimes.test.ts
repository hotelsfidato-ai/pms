import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { nightAuditReport } from "../../../src/modules/reports/builders/nightAudit.ts";
import { propertyById } from "../../../src/modules/reports/figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT REPORT'S TIMES READ THE SAME IN ANY TIME ZONE
   (found 28 October, release 14)

   The live database runs in GMT. Arrival, Departure and Entered On were
   written with Postgres's `OF`, which in GMT is "+00" - an offset a
   browser cannot read - so the screen and the emailed PDF printed the raw
   "2026-10-26T09:15:03+00", in GMT, instead of the hotel's time. This
   machine's database runs in India time ("+05:30", readable), which is
   why no test saw it. The builder now writes UTC with a Z; this runs it
   on a connection set to GMT, as live is.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let pool: pg.Pool;
let db: pg.PoolClient;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: SUPER, max: 1 });
  db = await pool.connect();
  await db.query("set time zone 'GMT'");
});
afterAll(async () => { db.release(); await pool.end(); });

describe("the Night audit report in a GMT database", () => {
  it("writes every time so the screen and the PDF can read it", async () => {
    const { rows: [h] } = await db.query<{ id: string; bd: string }>(
      "select id::text, app.business_date(id)::text as bd from hotels where code = '5EL'");
    /* Its arrivals' and payments' days: the latest business date that has both. */
    const { rows: [d] } = await db.query<{ day: string }>(
      `select fp.business_date::text as day from folio_postings fp
        where fp.hotel_id = $1 and fp.amount < 0 order by fp.business_date desc limit 1`, [h!.id]);
    const doc = await nightAuditReport(db, (await propertyById(db, h!.id))!, d?.day ?? h!.bd);
    const times: string[] = [];
    for (const section of doc.sections) {
      for (const row of section.rows as { cells?: Record<string, unknown> }[]) {
        for (const key of ["arrival", "departure", "enteredOn"]) {
          const v = row.cells?.[key];
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) times.push(v);
        }
      }
    }
    expect(times.length, "the report carried no times to check").toBeGreaterThan(0);
    for (const t of times) expect(Number.isNaN(new Date(t).getTime()), t).toBe(false);
  });
});
