import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  EQUIPMENT_GRANTS, ROLE_NAMES, refusedFor, type EquipmentAction,
} from "../../../src/modules/equipment/grants.ts";
import {
  grantsFor, ROLES, ASSIGNABLE_ROLES,
} from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT WITH THE EQUIPMENT REGISTER — every role, every door

   The owner's table of 16 September (plan § 6), as the server enforces
   it. Reading needs `view`; adding and importing need `create`; a
   change, a move, a status or a retirement needs `edit`; approving a
   retirement needs `approve`; an export needs `export`.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the GM can
   write would pass with no guard at all. Every role a person can be
   given is tried at every door, and a refusal must leave NOTHING
   behind — no item, no category, no history row, no split line.

   Each role gets its own fixtures (named EQTEST <role>), made directly
   in the scratch database and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const ACTIONS: EquipmentAction[] = ["view", "create", "edit", "approve", "export"];

/* Named by hand so a reader sees them; the last test stops a new role
   slipping past untested. */
const EVERY_ROLE = [
  "owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk",
  "housekeeping", "kitchen_manager", "chef", "pos", "stores", "finance", "read_only",
];

let hotelId: string;
let roomA: string;
let roomB: string;
let ownerId: string;
const staffByRole = new Map<string, string>();
let gmElsewhereId: string;

interface Fixture { tagged: string; counted: string; waiting: string }
const fixtures = new Map<string, Fixture>();

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const email = `eqg-${key}@fidato.in`;
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [email, `EQTEST ${key}`, `test-uid-eqg-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const r of roles) {
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = $3`, [id, r.role, r.hotel]);
  }
  return id;
};

/** Three things for one role to try its hand on. */
const makeFixture = async (role: string): Promise<Fixture> => {
  const one = async (values: string) =>
    (await sql(`insert into equipment_items ${values} returning id::text`,
               [hotelId, roomA, role])).rows[0].id as string;
  const tagged = await one(
    `(hotel_id, name, held_as, tag, room_id)
     values ($1, 'EQTEST ' || $3::text || ' tv', 'tagged', 'EQG-' || $3::text || '-1', $2)`);
  const counted = await one(
    `(hotel_id, name, held_as, quantity, room_id)
     values ($1, 'EQTEST ' || $3::text || ' kettles', 'counted', 5, $2)`);
  const waiting = await one(
    `(hotel_id, name, held_as, tag, room_id)
     values ($1, 'EQTEST ' || $3::text || ' fridge', 'tagged', 'EQG-' || $3::text || '-2', $2)`);
  await sql(
    `update equipment_items
        set retire_requested_at = now(), retire_requested_by = $2, retire_reason = 'EQTEST'
      where id = $1`, [waiting, ownerId]);
  return { tagged, counted, waiting };
};

const item = async (id: string) => (await sql(
  `select name, room_id::text, status, quantity, retire_requested_at is not null as waiting,
          (select count(*)::int from equipment_items s where s.split_from = i.id) as splits,
          (select count(*)::int from equipment_history h
            where h.item_id = i.id and h.kind not in ('added', 'retire_requested')) as history
     from equipment_items i where id = $1`, [id])).rows[0];

const countNamed = async (name: string) => Number((await sql(
  "select count(*)::int as n from equipment_items where name = $1", [name])).rows[0].n);

const clearAll = async () => {
  const db = await admin();
  try {
    await db.query("begin");
    await db.query("alter table equipment_history disable trigger equipment_history_append_only");
    await db.query(
      `delete from equipment_history where item_id in
         (select id from equipment_items where name like 'EQTEST %')`);
    /* One statement: a split line points at its line, and the key is
       checked when the statement ends, by which time both are gone. */
    await db.query("delete from equipment_items where name like 'EQTEST %'");
    await db.query("alter table equipment_history enable trigger equipment_history_append_only");
    await db.query("delete from equipment_categories where name like 'EQTEST%'");
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
};

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  const rooms = (await sql(
    `select id::text from rooms where hotel_id = $1 and is_active
      order by length(number), number limit 2`, [hotelId])).rows;
  roomA = rooms[0].id;
  roomB = rooms[1].id;
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;

  await clearAll();
  for (const role of ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: "5EL", role }]));
    fixtures.set(role, await makeFixture(role));
  }
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: "5EL", role: "front_desk" },
  ]);
});

afterAll(async () => {
  await clearAll();
  const ids = [...staffByRole.values(), gmElsewhereId];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

/* ── The two copies of the rule ─────────────────────────────────────── */

describe("the server's table of who may do what with equipment", () => {
  for (const action of ACTIONS) {
    it(`is the website's table for "${action}", exactly`, () => {
      /* src/lib/permissions.ts is the owner's table. When it changes, this
         fails until api/src/modules/equipment/grants.ts says the same. */
      const website = ROLES.filter((r) => grantsFor(r, "equipment").includes(action));
      expect([...EQUIPMENT_GRANTS[action]].sort()).toEqual([...website].sort());
    });
  }

  it("covers every action the website grants on equipment", () => {
    /* A new action given to a role (`cancel`, `delete`) with no door here
       would be a permission nothing enforces. The owner is left out: the
       owner holds EVERY action on EVERY resource by a blanket grant, which
       names `cancel` and `delete` without meaning either here. */
    const granted = new Set(
      ROLES.filter((r) => r !== "owner").flatMap((r) => [...grantsFor(r, "equipment")]));
    expect([...granted].filter((a) => !ACTIONS.includes(a as EquipmentAction))).toEqual([]);
  });

  it("offers no way to delete anything, even to the owner — a thing leaves by being retired", async () => {
    const { tagged } = fixtures.get("owner")!;
    const res = await call(ownerId, `/equipment/items/${tagged}`, "DELETE");
    expect(res.status).toBe(404);
    expect(await item(tagged)).toBeTruthy();
  });

  it("names every role it lets in, so a refusal can say whom to ask", () => {
    for (const action of ACTIONS) {
      for (const role of EQUIPMENT_GRANTS[action]) {
        expect(ROLE_NAMES[role], `${role} has no name in a refusal`).toBeTruthy();
      }
    }
    expect(refusedFor("approve")).toBe(
      "Approving a retirement is for the owner, an administrator or the general manager. "
      + "Ask one of them.");
  });
});

/* ── Every role at every door ───────────────────────────────────────── */

const may = (role: string, action: EquipmentAction) =>
  (EQUIPMENT_GRANTS[action] as readonly string[]).includes(role);

const expectRefused = async (res: Response, action: EquipmentAction) => {
  expect(res.status, await res.clone().text()).toBe(403);
  const body = (await res.json()) as { ok: boolean; reason: string };
  expect(body.ok).toBe(false);
  expect(body.reason).toBe(refusedFor(action));
};

describe("reading the register (view)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "view") ? "lets" : "refuses"} ${role}`, async () => {
      const staff = staffByRole.get(role)!;
      for (const path of ["", "/options", `/items/${fixtures.get(role)!.tagged}`]) {
        const res = await call(staff, `/equipment${path}`);
        if (may(role, "view")) expect(res.status, await res.clone().text()).toBe(200);
        else await expectRefused(res, "view");
      }
    });
  }
});

describe("adding an item (create)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "create") ? "lets" : "refuses"} ${role}`, async () => {
      const name = `EQTEST add ${role}`;
      const res = await call(staffByRole.get(role)!, "/equipment", "POST", {
        name, heldAs: "counted", quantity: 3, roomId: roomA,
        category: `EQTEST category ${role}`,
      });
      if (may(role, "create")) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await countNamed(name)).toBe(1);
      } else {
        await expectRefused(res, "create");
        expect(await countNamed(name), `${role} was refused and an item was written`).toBe(0);
        const cats = await sql(
          "select count(*)::int as n from equipment_categories where name = $1",
          [`EQTEST category ${role}`]);
        expect(cats.rows[0].n, `${role} was refused and a category was written`).toBe(0);
      }
    });
  }
});

describe("importing a file (create)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "create") ? "lets" : "refuses"} ${role}`, async () => {
      const name = `EQTEST import ${role}`;
      const room = (await sql("select number from rooms where id = $1", [roomA])).rows[0].number;
      const res = await call(staffByRole.get(role)!, "/equipment/import", "POST", {
        dryRun: false,
        rows: [{ name, heldAs: "count", quantity: "2", room }],
      });
      if (may(role, "create")) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await countNamed(name)).toBe(1);
      } else {
        await expectRefused(res, "create");
        expect(await countNamed(name), `${role} was refused and a row was imported`).toBe(0);
      }
    });
  }
});

describe("changing, moving and repairing (edit)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "edit") ? "lets" : "refuses"} ${role}`, async () => {
      const staff = staffByRole.get(role)!;
      const { tagged } = fixtures.get(role)!;
      const before = await item(tagged);

      const edit = await call(staff, `/equipment/items/${tagged}`, "PATCH",
        { name: `EQTEST ${role} tv renamed` });
      const move = await call(staff, `/equipment/items/${tagged}/move`, "POST", { roomId: roomB });
      const repair = await call(staff, `/equipment/items/${tagged}/status`, "POST",
        { status: "under_repair" });
      const after = await item(tagged);

      if (may(role, "edit")) {
        for (const res of [edit, move, repair]) {
          expect(res.status, await res.clone().text()).toBe(200);
        }
        expect(after.name).toBe(`EQTEST ${role} tv renamed`);
        expect(after.room_id).toBe(roomB);
        expect(after.status).toBe("under_repair");
      } else {
        for (const res of [edit, move, repair]) await expectRefused(res, "edit");
        expect(after, `${role} was refused and the item changed`).toEqual(before);
      }
    });
  }
});

describe("retiring (edit)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "edit") ? "lets" : "refuses"} ${role}`, async () => {
      const { counted } = fixtures.get(role)!;
      const res = await call(staffByRole.get(role)!, `/equipment/items/${counted}/retire`, "POST",
        { reason: "EQTEST broken", count: 2 });
      const after = await item(counted);

      if (may(role, "edit")) {
        /* A counted line goes straight through, whoever retires it — the
           owner's answer. Two of five: a new retired line, three left. */
        expect(res.status, await res.clone().text()).toBe(200);
        expect(after.quantity).toBe(3);
        expect(after.splits).toBe(1);
      } else {
        await expectRefused(res, "edit");
        expect(after.quantity, `${role} was refused and the count changed`).toBe(5);
        expect(after.splits, `${role} was refused and a line was split off`).toBe(0);
        expect(after.history).toBe(0);
      }
    });
  }
});

describe("approving and declining a retirement (approve)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "approve") ? "lets" : "refuses"} ${role}`, async () => {
      const staff = staffByRole.get(role)!;
      const { waiting } = fixtures.get(role)!;

      const decline = await call(staff, `/equipment/items/${waiting}/retire/decline`, "POST", {});
      if (may(role, "approve")) {
        expect(decline.status, await decline.clone().text()).toBe(200);
        expect((await item(waiting)).waiting).toBe(false);
        /* Asked again, then approved. */
        await sql(
          `update equipment_items set retire_requested_at = now(), retire_requested_by = $2,
                  retire_reason = 'EQTEST' where id = $1`, [waiting, ownerId]);
        const approve = await call(staff, `/equipment/items/${waiting}/retire/approve`, "POST");
        expect(approve.status, await approve.clone().text()).toBe(200);
        expect((await item(waiting)).status).toBe("retired");
      } else {
        await expectRefused(decline, "approve");
        const approve = await call(staff, `/equipment/items/${waiting}/retire/approve`, "POST");
        await expectRefused(approve, "approve");
        const after = await item(waiting);
        expect(after.status, `${role} was refused and it was retired`).toBe("in_use");
        expect(after.waiting, `${role} was refused and the request was cleared`).toBe(true);
      }
    });
  }
});

describe("exporting the register (export)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "export") ? "lets" : "refuses"} ${role}`, async () => {
      const res = await call(staffByRole.get(role)!, "/equipment/export");
      if (may(role, "export")) expect(res.status, await res.clone().text()).toBe(200);
      else await expectRefused(res, "export");
    });
  }
});

describe("whose role counts", () => {
  it("lets a group administrator do everything", async () => {
    expect((await call(ownerId, "/equipment")).status).toBe(200);
    expect((await call(ownerId, "/equipment/export")).status).toBe(200);
  });

  it("asks the role AT THIS HOTEL — a GM elsewhere is reception here", async () => {
    const name = "EQTEST gm elsewhere";
    const res = await call(gmElsewhereId, "/equipment", "POST",
      { name, heldAs: "counted", quantity: 1, roomId: roomA });
    await expectRefused(res, "create");
    expect(await countNamed(name)).toBe(0);
    /* …and may still read it, as reception may. */
    expect((await call(gmElsewhereId, "/equipment")).status).toBe(200);
  });

  it("covers every role a person can be given", () => {
    expect([...staffByRole.keys()].sort()).toEqual([...EVERY_ROLE].sort());
  });
});
