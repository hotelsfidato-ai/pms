import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A WRONG ID LEAVES THE DEFAULT ALONE

   PUT /:code/cancellation-policies/:id/default cleared the hotel's default
   before it looked for the policy it was sent, then refused - and inside
   withSession a refusal is a commit (MEMORY 243), so the clear stayed and
   new bookings silently carried no terms.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerId: string;
let policyId: string;
let before: string[];

const defaults = async () => (await sql(
  `select p.id::text from cancellation_policies p join hotels h on h.id = p.hotel_id
    where h.code = '5EL' and p.applies_to_new_bookings`)).rows.map((r) => r.id as string);

const setDefault = (id: string) =>
  app.request(`/api/hotels/5EL/cancellation-policies/${id}/default`, {
    method: "PUT",
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    body: JSON.stringify({ on: true }),
  });

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  before = await defaults();
  policyId = (await sql(
    `insert into cancellation_policies (hotel_id, name, cancel_basis, no_show_basis)
     select id, 'POLDEF test terms', 'nothing', 'nothing' from hotels where code = '5EL'
     on conflict (hotel_id, name) do update set is_active = true
     returning id::text`)).rows[0].id;
});

afterAll(async () => {
  await sql("update cancellation_policies set applies_to_new_bookings = false, is_active = false where id = $1",
    [policyId]);
  if (before[0]) {
    await sql("update cancellation_policies set applies_to_new_bookings = true where id = $1", [before[0]]);
  }
  await closePool();
});

describe("the default cancellation policy", () => {
  it("a wrong id is refused, and the old default stays", async () => {
    expect((await setDefault(policyId)).status).toBe(200);
    expect(await defaults()).toEqual([policyId]);

    const res = await setDefault("00000000-0000-0000-0000-000000000000");
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("That policy is not here.");
    expect(await defaults()).toEqual([policyId]);
  });
});
