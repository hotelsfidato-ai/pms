import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A WRITE IS DATED BY THE HOTEL, NOT BY THE DEVICE (28 September)

   A device learns the business date at sign-in. After the night audit on
   another desk it still sends yesterday, and the server used to take it:
   a charge hit the closed-day trigger as a 500, an early check-in moved
   the arrival back onto a closed day. Now every writer that took
   `businessDate` (api/src/businessDate.ts resolveDate) uses the hotel's.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DEVICEDATE";
let owner = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("delete from folio_postings where description like $1", [`${TAG}%`]);
  } finally {
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
  await closePool();
});

describe("a charge from a screen that still shows yesterday", () => {
  it("lands on the hotel's business date", async () => {
    const [stay] = await sql<{ id: string }>(
      `select r.id::text from reservations r
         join folios f on f.reservation_id = r.id and f.status = 'open'
        where r.hotel_id = (select id from hotels where code = '5EL')
          and r.status = 'checked_in'
        limit 1`);
    const [day] = await sql<{ today: string; yesterday: string }>(
      `select to_char(app.business_date(id), 'YYYY-MM-DD') as today,
              to_char(app.business_date(id) - 1, 'YYYY-MM-DD') as yesterday
         from hotels where code = '5EL'`);

    const res = await app.request(`/api/hotels/5EL/stays/${stay!.id}/charges`, {
      method: "POST",
      headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
      body: JSON.stringify({
        category: "Miscellaneous", description: `${TAG} from yesterday's screen`,
        amount: 100, taxable: false, businessDate: day!.yesterday,
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const [row] = await sql<{ d: string }>(
      "select business_date::text as d from folio_postings where description like $1", [`${TAG}%`]);
    expect(row!.d).toBe(day!.today);
  });
});
