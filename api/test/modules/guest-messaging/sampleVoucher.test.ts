import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS › DOCUMENTS' SAMPLE VOUCHER (the owner's D27-344, D27-348)

   A made-up booking in the hotel's own voucher, SAMPLE · NOT VALID: one A4
   PDF for whoever may see the settings, refused to reception. Nothing is
   booked, kept or sent.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";
let desk = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const get = (who: string) => app.request("/api/hotels/5EL/documents/sample-voucher.pdf",
  { headers: { "x-dev-staff-id": who } });

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const [d] = await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ('sample-voucher-desk@fidato.in', 'Sample Desk', 'test-uid-sv-desk')
     on conflict (email) do update set is_active = true returning id::text`);
  desk = d!.id;
  await sql("delete from staff_hotels where staff_id = $1", [desk]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'front_desk' from hotels where code = '5EL'", [desk]);
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = $1", [desk]);
  await closePool();
});

describe("the sample voucher", () => {
  it("is one A4 PDF, marked as a sample, for the settings' people", async () => {
    const res = await get(owner);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1);
    const sent = await sql<{ n: number }>("select count(*)::int as n from messages_sent where sent_at > now() - interval '1 minute'");
    expect(sent[0]!.n, "nothing is sent").toBe(0);
  });

  it("is refused to reception", async () => {
    expect((await get(desk)).status).toBe(403);
  });
});
