import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withDrawer } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE PRESS, ONE LINE (28 September, the release review)

   A charge and a payment took no idempotency key, though
   folio_postings.idempotency_key and its unique index have been there
   since 011. The desk now sends one per press; a repeat of it gets the
   first line back and writes nothing. The button's half is
   src/modules/finance/onePress.test.tsx.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";
let stay = "";
const keys = [randomUUID(), randomUUID()];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const press = (path: string, body: unknown, key: string) =>
  app.request(`/api/hotels/5EL/stays/${stay}/${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });

const lines = async (key: string) =>
  (await sql<{ id: string }>("select id::text from folio_postings where idempotency_key = $1", [key]))
    .map((r) => r.id);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  stay = (await sql<{ id: string }>(
    `select r.id::text from reservations r
       join folios f on f.reservation_id = r.id and f.status = 'open'
      where r.hotel_id = (select id from hotels where code = '5EL') and r.status = 'checked_in'
      limit 1`))[0]!.id;
});

afterAll(async () => {
  await sql(`delete from payments where posting_id in
               (select id from folio_postings where idempotency_key = any($1::uuid[]))`, [keys]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("delete from folio_postings where idempotency_key = any($1::uuid[])", [keys]);
  } finally {
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
  await closePool();
});

describe("the same press, sent twice", () => {
  it("posts one charge, and answers the repeat with it", async () => {
    const charge = { category: "Miscellaneous", description: "One press test", amount: 50, taxable: false };
    const first = await press("charges", charge, keys[0]!);
    const again = await press("charges", charge, keys[0]!);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(again.status).toBe(200);
    const posted = await lines(keys[0]!);
    expect(posted).toHaveLength(1);
    expect(((await again.json()) as { data: { id: string } }).data.id).toBe(posted[0]);
  });

  it("takes one payment", async () => {
    /* heldAsCredit: whatever that stay owes, the question here is the key. */
    const payment = { method: "Cash", amount: 10, heldAsCredit: true };
    await withDrawer("5EL", owner, async () => {
      expect((await press("payments", payment, keys[1]!)).status).toBe(200);
      expect((await press("payments", payment, keys[1]!)).status).toBe(200);
    });
    expect(await lines(keys[1]!)).toHaveLength(1);
  });
});
