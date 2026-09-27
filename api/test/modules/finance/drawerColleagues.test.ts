import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHOM THE DRAWER CAN BE HANDED TO - the owner's D27-97, 28 September

   Read from `staff` and `staff_hotels`, the list was empty for anybody who
   does not run the hotel: row security shows each person only their own
   roster line (housekeeping's HK-14). It reads app.hotel_people (149) now,
   names only. Tried as reception, who opens a drawer and does not run the
   hotel. Everything is named DRWTEST and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ids: string[] = [];
const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`drw-${key}@fidato.in`, `DRWTEST ${key}`, `test-uid-drw-${key}`]);
  const id = rows[0].id as string;
  ids.push(id);
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
    [id, role]);
  return id;
};

let clerk: string;
beforeAll(async () => {
  clerk = await person("clerk", "front_desk");
  await person("mate", "front_desk");
});

afterAll(async () => {
  await sql("delete from cashier_shifts where staff_id = any($1)", [ids]);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the drawer's hand-over list (D27-97)", () => {
  it("offers reception the other people at the hotel, and never themselves", async () => {
    const open = await call(clerk, "/cashier-shift/open", "POST", { opening: 0 });
    expect(open.status, await open.clone().text()).toBe(200);
    const res = await call(clerk, "/cashier-shift");
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { colleagues: { name: string }[] }).colleagues.map((p) => p.name);
    expect(names).toContain("DRWTEST mate");
    expect(names).not.toContain("DRWTEST clerk");
  });
});
