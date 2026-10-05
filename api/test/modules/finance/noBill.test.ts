import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A STAY WITH NO BILL — FIN-2, the owner's D17-16

   GET /:code/stays/:id/folio answered a stay with nothing posted as a
   folio of zeros marked "settled", and the screens printed ₹0 Settled —
   a paid bill, for a stay nobody has billed. It now answers "no bill";
   an unknown stay is still plainly not found; a billed stay is unchanged.
   Read-only: nothing here writes.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const asOwner = (path: string) =>
  app.request(`/api/hotels${path}`, { headers: { "x-dev-staff-id": "dev-owner" } });

afterAll(async () => { await closePool(); });

describe("a stay's bill", () => {
  it("is 'no bill' - not ₹0 settled - when nothing has been posted", async () => {
    const { rows } = await sql(
      `select r.id::text from reservations r join hotels h on h.id = r.hotel_id
        where h.code = '5EL'
          and not exists (select 1 from folio_postings fp where fp.reservation_id = r.id)
        limit 1`);
    expect(rows[0], "the demo has a stay with nothing posted").toBeTruthy();

    const res = await asOwner(`/5EL/stays/${rows[0].id}/folio`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { noBill?: boolean; balance?: number };
    expect(body.noBill).toBe(true);
    expect(body.balance, "no zero balance is invented").toBeUndefined();
  });

  it("is plainly not found for a stay that does not exist", async () => {
    const res = await asOwner("/5EL/stays/00000000-0000-0000-0000-000000000000/folio");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { noBill?: boolean }).noBill).toBeUndefined();
  });

  it("is unchanged for a stay that has been billed", async () => {
    /* A stay whose OWN folio holds a line still standing, the route's own
       meaning (D27-226). "Any posting naming the stay" also caught a stay
       whose lines were reversed or sit on a group's master bill - truly no
       bill of its own - and which one `limit 1` found depended on what the
       other test files had written by then (4 Oct gates). */
    const { rows } = await sql(
      `select r.id::text from reservations r join hotels h on h.id = r.hotel_id
        where h.code = '5EL'
          and exists (select 1 from folio_postings fp join folios f on f.id = fp.folio_id
                       where f.reservation_id = r.id and fp.reverses_id is null
                         and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id))
        order by r.id
        limit 1`);
    const res = await asOwner(`/5EL/stays/${rows[0].id}/folio`);
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { balance: number }).balance).toBe("number");
  });
});
