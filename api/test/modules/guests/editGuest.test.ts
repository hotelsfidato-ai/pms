import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   GU-1 · CORRECTING A GUEST (QA, 28 September - BLOCKS WORK)

   No screen could correct a guest's phone, email, name, address or
   nationality. The owner: Edit guest on Guest 360 and the stay panel, for
   the roles holding customer:edit, every change audited.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const TAG = `GU1-${process.pid}`;
let guestId = "";
let stranger = "";
const uid = (role: string) => `test-uid-gu1-${role}`;

const call = (who: string, method: string, id: string, body?: unknown) =>
  app.request(`/api/hotels/5EL/guests/${id}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const [hotel] = await sql<{ id: string }>("select id::text from hotels where code = '5EL'");
  for (const role of ["front_desk", "housekeeping"]) {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`gu1-${role}@fidato.in`, `${TAG} ${role}`, uid(role)]);
    await sql("delete from staff_hotels where staff_id = $1", [s!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
      [s!.id, hotel!.id, role]);
  }
  [{ id: guestId }] = await sql<{ id: string }>(
    "insert into guests (full_name, phone) values ($1, '9811100000') returning id::text",
    [`${TAG} Asha Kulkarny`]) as [{ id: string }];
  await sql(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status)
     select h.id, $2, $1, (select id from room_types where hotel_id = h.id limit 1),
            date '2029-05-10', date '2029-05-12', 3000, 'confirmed'
       from hotels h where h.code = '5EL'`, [guestId, `${TAG}-R`]);
  [{ id: stranger }] = await sql<{ id: string }>(
    "insert into guests (full_name) values ($1) returning id::text", [`${TAG} never here`]) as [{ id: string }];
});

afterAll(async () => {
  await sql("delete from reservations where reference = $1", [`${TAG}-R`]);
  await sql("delete from staff_hotels where staff_id in (select id from staff where email like 'gu1-%')");
  await closePool();
});

describe("GU-1 · Edit guest", () => {
  it("reception reads the record, and corrects it; the change is audited", async () => {
    const read = await call(uid("front_desk"), "GET", guestId);
    expect(read.status, await read.clone().text()).toBe(200);
    expect(await read.json()).toMatchObject({ fullName: `${TAG} Asha Kulkarny`, nationality: "IN" });

    const res = await call(uid("front_desk"), "PATCH", guestId, {
      title: "Ms", fullName: `${TAG} Asha Kulkarni`, phone: "+91 98111 00001",
      email: "asha@example.com", nationality: "gb", city: "Pune",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { guest: unknown }).guest).toMatchObject({
      title: "Ms", fullName: `${TAG} Asha Kulkarni`, phone: "+91 98111 00001",
      email: "asha@example.com", nationality: "GB", city: "Pune",
    });
    const audited = await sql<{ n: string }>(
      `select count(*)::text as n from audit_log
        where table_name = 'guests' and row_id = $1 and action = 'UPDATE'`, [guestId]);
    expect(Number(audited[0]!.n)).toBeGreaterThan(0);
  });

  it.each([
    ["a phone", { phone: "abc" }, /not a phone number/],
    ["an email", { email: "not-an-email" }, /not an email address/],
    ["a country", { nationality: "ZZ" }, /not a country code/],
    ["a blank name", { fullName: " " }, "A guest has a name."],
    ["a title", { title: "Sir" }, /A title is Mr, Ms, Mrs, Dr or none/],
  ])("refuses %s, and writes nothing", async (_, body, why) => {
    const before = await sql("select to_jsonb(g) as g from guests g where id = $1", [guestId]);
    const res = await call(uid("front_desk"), "PATCH", guestId, body);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(why);
    expect(await sql("select to_jsonb(g) as g from guests g where id = $1", [guestId])).toEqual(before);
  });

  it("is refused to housekeeping, both the record and the change", async () => {
    expect((await call(uid("housekeeping"), "GET", guestId)).status).toBe(403);
    expect((await call(uid("housekeeping"), "PATCH", guestId, { phone: "9811100002" })).status).toBe(403);
  });

  it("finds no guest who never stayed here", async () => {
    expect((await call(uid("front_desk"), "GET", stranger)).status).toBe(404);
    expect((await call(uid("front_desk"), "PATCH", stranger, { phone: "9811100003" })).status).toBe(404);
  });
});
