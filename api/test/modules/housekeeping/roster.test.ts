import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO A ROOM CAN BE GIVEN TO - the owner, 28 September

   A Hotel Manager's board listed nobody but themselves, and every room as
   Unassigned even when it was somebody's: row security shows each person
   only their own roster line, so the colleague rule (027) found nobody.
   The owner: "Everyone sees their hotel's staff" - names and roles, at
   their own hotel, never another hotel's (app.hotel_people, 149).

   Everything is named HKTEST-W and removed afterwards.
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

/* A second property of its own: the test database holds 5EL alone. */
const OTHER = "HKW";
const asOwner = async <T>(work: (db: import("pg").Client) => Promise<T>) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    await db.query(
      "select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), false)");
    return await work(db);
  } finally { await db.end(); }
};

const ids: string[] = [];
const person = async (key: string, hotel: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`hkw-${key}@fidato.in`, `HKTEST-W ${key}`, `test-uid-hkw-${key}`]);
  const id = rows[0].id as string;
  ids.push(id);
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $3 from hotels where code = $2",
    [id, hotel, role]);
  return id;
};

let manager: string, keeper: string, elsewhere: string, room: string;
const names = async (who: string) =>
  ((await (await call(who, "/housekeepers")).json()) as { name: string }[]).map((p) => p.name);

beforeAll(async () => {
  await asOwner((db) => db.query("select app.provision_property_unchecked($1,'Roster Other','Nowhere')", [OTHER]));
  manager = await person("manager", "5EL", "hotel_manager");
  keeper = await person("keeper", "5EL", "housekeeping");
  elsewhere = await person("elsewhere", OTHER, "housekeeping");
  room = (await sql(
    `select r.number from rooms r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.is_active order by r.number limit 1`)).rows[0].number;
});

afterAll(async () => {
  await sql("delete from housekeeping_assignments where staff_id = any($1)", [ids]);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await asOwner(async (db) => {
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where code = $1", [OTHER]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
  });
  await closePool();
});

describe("who works here (149)", () => {
  it("a Hotel Manager sees the housekeepers, and a housekeeper the Hotel Manager - not another hotel's", async () => {
    expect(await names(manager)).toContain("HKTEST-W keeper");
    expect(await names(keeper)).toContain("HKTEST-W manager");
    expect(await names(manager)).not.toContain("HKTEST-W elsewhere");
  });

  it("a Hotel Manager gives a room to a housekeeper, and both see whose it is", async () => {
    const res = await call(manager, `/housekeeping/assignments/${room}`, "PUT", { staffId: keeper });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { staffName: string }).staffName).toBe("HKTEST-W keeper");

    for (const who of [manager, keeper]) {
      const sheet = (await (await call(who, "/housekeeping/assignments")).json()) as {
        assignments: { room: string; staffName: string; role: string }[];
      };
      expect(sheet.assignments.find((a) => a.room === room)).toMatchObject({
        staffName: "HKTEST-W keeper", role: "housekeeping",
      });
    }
  });

  it("still refuses somebody who works at another hotel", async () => {
    const res = await call(manager, `/housekeeping/assignments/${room}`, "PUT", { staffId: elsewhere });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("That person does not work at this property.");
  });

  it("gives names and roles only, and nothing for a hotel the caller does not work at", async () => {
    const { rows: cols } = await sql(
      `select string_agg(a.attname, ',' order by a.attnum) as cols
         from pg_proc p, unnest(p.proargnames) with ordinality a(attname, attnum)
        where p.oid = 'app.hotel_people(uuid)'::regprocedure and p.proargmodes[a.attnum] = 't'`);
    expect(cols[0].cols).toBe("id,full_name,role,is_active");

    const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
    try {
      await db.query("begin");
      await db.query("select set_config('app.user_id', $1, true)", [manager]);
      /* The id is read before the role changes: as the manager, row security
         would hide the other hotel itself and the count be 0 for that. */
      const other = (await db.query("select id::text from hotels where code = $1", [OTHER])).rows[0].id;
      const here = (await db.query("select id::text from hotels where code = '5EL'")).rows[0].id;
      await db.query("set local role pms_app");
      const count = async (hotel: string) =>
        (await db.query("select count(*)::int as n from app.hotel_people($1)", [hotel])).rows[0].n as number;
      expect(await count(other)).toBe(0);
      expect(await count(here)).toBeGreaterThan(1);
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
});
