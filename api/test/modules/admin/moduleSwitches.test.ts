import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  MODULE_SWITCH_ROLES as SERVER_LIST, MODULE_SWITCH_REFUSED,
} from "../../../src/modules/admin/grants.ts";
import { SWITCHABLE } from "../../../src/modules/admin/moduleSwitches.ts";
import { MODULE_SWITCH_ROLES as SCREEN_LIST } from "../../../../src/modules/admin/moduleSwitchRoles.ts";
import { ASSIGNABLE_ROLES } from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SWITCH A MODULE — D17-36

   The owner, 17 September: "the GM may open Settings; the module switches
   stay owner and admin only". Until then the route asked
   `app.manages_hotel` — a group administrator, or owner/GM at this hotel
   — so the GM could switch and an administrator could not: the decision's
   two roles, the wrong way round.

   Every role a person can be given tries to flip Banquet hall at 5EL. A
   refusal must leave the switch where it was; an allowed flip is put back,
   so no other test finds the property changed.

   ⚠ THE REFUSALS ARE THE POINT.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "D1736TEST";

let ownerId: string;
let gmElsewhereId: string;
const staffByRole = new Map<string, string>();

const banquetIsOn = async () => (await sql(
  "select app.module_enabled(id, 'banquet') as on from hotels where code = $1",
  [HOTEL])).rows[0].on as boolean;

const flip = (staffId: string, enabled: boolean) =>
  app.request(`/api/hotels/${HOTEL}/modules/banquet`, {
    method: "POST",
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`d1736-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-d1736-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const r of roles) {
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = $3`, [id, r.role, r.hotel]);
  }
  return id;
};

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  for (const role of ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: HOTEL, role }]));
  }
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: HOTEL, role: "front_desk" },
  ]);
});

afterAll(async () => {
  await sql(
    `delete from staff_hotels where staff_id in
       (select id from staff where email like 'd1736-%@fidato.in')`);
  await sql("update staff set is_active = false where email like 'd1736-%@fidato.in'");
  await closePool();
});

describe("one list, on the screen and on the server", () => {
  it("the switch route's roles are the Settings screen's", () => {
    expect([...SERVER_LIST].sort()).toEqual([...SCREEN_LIST].sort());
  });

  it("and they are the owner's decision: owner and admin, not the GM", () => {
    expect([...SCREEN_LIST].sort()).toEqual(["admin", "owner"]);
  });
});

describe("every role tries to flip Banquet hall", () => {
  it.each(ASSIGNABLE_ROLES.map((role) => ({ role, may: SCREEN_LIST.includes(role) })))(
    "$role → allowed: $may",
    async ({ role, may }) => {
      const before = await banquetIsOn();
      const res = await flip(staffByRole.get(role)!, !before);
      const text = await res.clone().text();

      if (may) {
        expect(res.status, `${role} should switch: ${text}`).toBe(200);
        expect(await banquetIsOn()).toBe(!before);
        /* Put it back, as the same person. */
        expect((await flip(staffByRole.get(role)!, before)).status).toBe(200);
        expect(await banquetIsOn()).toBe(before);
      } else {
        expect(res.status, `${role} should be refused: ${text}`).toBe(403);
        const body = (await res.json()) as { ok: boolean; reason: string };
        expect(body.ok).toBe(false);
        expect(body.reason).toBe(MODULE_SWITCH_REFUSED);
        expect(await banquetIsOn(), `${role}'s refusal was cosmetic - the switch moved`).toBe(before);
      }
    },
  );
});

describe("who is asking, beyond the role list", () => {
  it("a group administrator switches, and puts it back", async () => {
    const before = await banquetIsOn();
    expect((await flip(ownerId, !before)).status).toBe(200);
    expect((await flip(ownerId, before)).status).toBe(200);
    expect(await banquetIsOn()).toBe(before);
  });

  it("a GM at another hotel who is reception here is refused here", async () => {
    const before = await banquetIsOn();
    const res = await flip(gmElsewhereId, !before);
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await banquetIsOn()).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE LIST THE SCREEN IS OFFERED AND THE LIST THE SERVER ACCEPTS

   ⚠ THEY WERE TWO LITERALS AND THEY DREW APART (LAU-3, 19 September).
   The GET offered six modules; the POST accepted three. So Settings drew
   a switch for `laundry`, `spa` and `channel_manager`, and every one of
   them answered `409 There is no "laundry" module.` when a person used
   it. `channel_manager` had been live in that state since migration 108
   and nobody had tried it.

   Nothing in the database was wrong: `hotel_modules_known` has known all
   six since 115. The fault was entirely in this file's two copies.

   There is ONE list now, and these three checks hold it in place — to
   itself at both ends, and to the database's own definition of what a
   module is. A module this system offers but cannot switch is the fault
   that was here; a module it can switch but the database rejects would
   be the same fault pointing the other way.
   ══════════════════════════════════════════════════════════════════ */
describe("what a module is, in one place", () => {
  it("offers exactly the modules it will accept", async () => {
    const res = await app.request(`/api/hotels/${HOTEL}/modules`, {
      headers: { "x-dev-staff-id": ownerId },
    });
    expect(res.status).toBe(200);
    const { modules } = await res.json() as { modules: { module: string }[] };

    expect([...modules.map((m) => m.module)].sort())
      .toEqual([...SWITCHABLE].sort());
  });

  it("accepts every module it offers - none of them answers 'there is no such module'", async () => {
    for (const module of SWITCHABLE) {
      const was = (await sql(
        "select app.module_enabled(id, $2) as on from hotels where code = $1",
        [HOTEL, module])).rows[0].on as boolean;

      const res = await app.request(`/api/hotels/${HOTEL}/modules/${module}`, {
        method: "POST",
        headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
        body: JSON.stringify({ enabled: was }),
      });

      /* Flipped to what it already was, so nothing about this property
         changes whichever way the check goes. What is being asked is only
         whether the route KNOWS the module. */
      const body = await res.json() as { reason?: string };
      expect(body.reason ?? "", `the ${module} switch is drawn, so it must work`)
        .not.toContain("There is no");
      expect(res.status, `the ${module} switch answers`).toBe(200);
    }
  });

  it("offers nothing the database has never heard of", async () => {
    const { rows } = await sql(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'hotel_modules_known'`);
    const known = rows[0].def as string;
    for (const module of SWITCHABLE) {
      /* `reception_pos` is a per-hotel switch that is not a module row in
         the same sense - it is checked the same way and belongs on the
         screen, so it is allowed to be absent here. */
      if (module === "reception_pos") continue;
      expect(known, `the database knows "${module}"`).toContain(`'${module}'`);
    }
  });
});
