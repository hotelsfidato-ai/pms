import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO CAN BE NAMED AS THE WAITER - the owner's D27-97, 28 September

   Read from `staff` and `staff_hotels`, the list was the caller alone for
   anybody who does not run the hotel: row security shows each person only
   their own roster line (housekeeping's HK-14). It reads app.hotel_people
   (149) now, names only. Tried as a till operator. Everything is named
   WTRTEST and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const ids: string[] = [];
const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`wtr-${key}@fidato.in`, `WTRTEST ${key}`, `test-uid-wtr-${key}`]);
  const id = rows[0].id as string;
  ids.push(id);
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
    [id, role]);
  return id;
};

let till: string;
beforeAll(async () => {
  till = await person("till", "pos");
  await person("waiter", "front_desk");
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the waiters list (D27-97)", () => {
  it("offers a till operator the other people at the hotel", async () => {
    const res = await app.request("/api/hotels/5EL/till/waiters", { headers: { "x-dev-staff-id": till } });
    expect(res.status, await res.clone().text()).toBe(200);
    const names = ((await res.json()) as { waiters: { name: string }[] }).waiters.map((w) => w.name);
    expect(names).toContain("WTRTEST waiter");
    expect(names).toContain("WTRTEST till");
  });
});
