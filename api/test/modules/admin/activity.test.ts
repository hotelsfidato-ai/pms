import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FULL ACTIVITY LOG (D27-243 5.1, D27-245 Q-A)

   The owner, an Admin and the GM read their hotel's changes; the
   changes that belong to no hotel (a guest's record, a person) are the
   owner's and an Admin's, as "Across the group"; a guest's details are
   "changed", never a value. The changes are made here as the database's
   own user, so the triggers record them exactly as a screen's would.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const RUN = Date.now();
const PHONE = `+9199${String(RUN).slice(-8)}`;
let owner: string;
let gm: string;
let desk: string;
let guestId: string;
let oldPhone: string | null;

const read = (who: string, query = "") =>
  app.request(`/api/hotels/5EL/activity${query}`, { headers: { "x-dev-staff-id": who } });

type Entry = { kind: string; table: string; action: string; changes: Array<{ field: string; from?: string | null; to?: string | null; masked?: true }> };

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  const at = async (email: string, role: string) => {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3) returning id::text`,
      [email, `ACT ${role}`, `test-uid-${email}`])).rows[0].id as string;
    await sql(`insert into staff_hotels (staff_id, hotel_id, role)
               select $1, id, $2 from hotels where code = '5EL'`, [id, role]);
    return id;
  };
  gm = await at(`act-gm-${RUN}@fidato.in`, "gm");
  desk = await at(`act-desk-${RUN}@fidato.in`, "front_desk");

  /* A booking changed at 5EL and one at Agra; a guest's phone changed. */
  for (const code of ["5EL", "AGR"]) {
    await sql(
      `update reservations set notes = $1
        where id = (select r.id from reservations r join hotels h on h.id = r.hotel_id
                     where h.code = $2 order by r.created_at limit 1)`,
      [`ACT-${RUN} ${code}`, code]);
  }
  const g = (await sql("select id::text, phone from guests order by created_at limit 1")).rows[0];
  guestId = g.id;
  oldPhone = g.phone;
  await sql("update guests set phone = $2 where id = $1", [guestId, PHONE]);
});

afterAll(async () => {
  await sql("update guests set phone = $2 where id = $1", [guestId, oldPhone]);
  await sql(`delete from staff_hotels where staff_id in (select id from staff where email like $1)`,
    [`act-%-${RUN}@fidato.in`]);
  await sql(`update staff set is_active = false where email like $1`, [`act-%-${RUN}@fidato.in`]);
  await closePool();
});

describe("who reads the activity log", () => {
  it("is refused to the desk, in a sentence", async () => {
    const res = await read(desk);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("general manager");
  });

  it("gives the GM their hotel's changes and not another hotel's, nor the group's", async () => {
    const res = await read(gm, "?kind=reservations&limit=200");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(`ACT-${RUN} 5EL`);
    expect(text).not.toContain(`ACT-${RUN} AGR`);
    const entries = (JSON.parse(text) as { entries: Entry[] }).entries;
    expect(entries.every((e) => e.kind === "Booking")).toBe(true);
    expect((await read(gm, "?scope=group")).status).toBe(403);
  });
});

describe("across the group (Q-A)", () => {
  it("shows the owner a guest's change as 'changed', never the number", async () => {
    const res = await read(owner, "?scope=group&kind=guests&limit=200");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(PHONE);
    const entries = (JSON.parse(text) as { entries: Entry[] }).entries;
    const phone = entries.flatMap((e) => e.changes).find((c) => c.field === "phone");
    expect(phone).toEqual({ field: "phone", masked: true });
  });

  it("pages", async () => {
    const res = await read(owner, "?limit=1");
    expect((await res.json() as { entries: Entry[] }).entries).toHaveLength(1);
  });
});
