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

   The owner's table (plan § 6, with S13), as the server enforces it:

     view     reading — and ASKING for a thing to leave the store (S15)
     create   adding, importing
     edit     changing; a move between rooms or into a store; a status;
              retiring
     approve  retiring a tagged item without waiting (the Hotel Manager's
              waits in the shared inbox, S16)
     export   the register, out

   Deciding a request is the core's, tried for every role in
   api/test/equipmentApproval.test.ts.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the GM can
   write would pass with no guard at all. Every role a person can be
   given is tried at every door, and a refusal must leave NOTHING
   behind — no item, category, move, split, request or history row.

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

const EVERY_ROLE = [
  "owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk",
  "housekeeping", "kitchen_manager", "chef", "pos", "bar", "stores", "finance", "read_only",
];

let hotelId: string;
let roomA: string;
let roomB: string;
let store: string;
let ownerId: string;
const staffByRole = new Map<string, string>();
let gmElsewhereId: string;

interface Fixture { tagged: string; counted: string; stored: string; costly: string }
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

/** An item and where it is, in ONE statement — the database checks at
    commit that every item is somewhere. */
const itemAt = async (
  values: { name: string; heldAs: "tagged" | "counted"; tag?: string; quantity?: number },
  where: { roomId?: string; locationId?: string },
): Promise<string> =>
  (await sql(
    `with i as (
       insert into equipment_items (hotel_id, name, held_as, tag, quantity)
       values ($1, $2, $3, $4, $5) returning id, hotel_id)
     insert into equipment_moves (hotel_id, item_id, kind, to_room_id, to_location_id)
     select hotel_id, id, 'placed', $6::uuid, $7::uuid from i
     returning item_id::text as id`,
    [hotelId, values.name, values.heldAs, values.tag ?? null, values.quantity ?? 1,
     where.roomId ?? null, where.locationId ?? null])).rows[0].id as string;

const makeFixture = async (role: string): Promise<Fixture> => ({
  tagged: await itemAt({ name: `EQTEST ${role} tv`, heldAs: "tagged", tag: `EQG-${role}-1` }, { roomId: roomA }),
  counted: await itemAt({ name: `EQTEST ${role} kettles`, heldAs: "counted", quantity: 5 }, { roomId: roomA }),
  stored: await itemAt({ name: `EQTEST ${role} fridge`, heldAs: "tagged", tag: `EQG-${role}-2` }, { locationId: store }),
  costly: await itemAt({ name: `EQTEST ${role} oven`, heldAs: "tagged", tag: `EQG-${role}-3` }, { roomId: roomB }),
});

/** Everything the refusal tests must see unchanged. */
const state = async (id: string) => (await sql(
  `select i.name, i.status, i.quantity,
          p.room_id::text, p.location_id::text,
          app.equipment_is_retired(i.id) as retired,
          (select count(*)::int from equipment_items s where s.split_from = i.id) as splits,
          (select count(*)::int from equipment_moves m where m.item_id = i.id) as moves,
          (select count(*)::int from approvals a
            where a.subject_id = i.id
               or a.subject_id in (select m.id from equipment_moves m where m.item_id = i.id)) as requests,
          (select count(*)::int from equipment_history h
            where h.item_id = i.id and h.kind <> 'added') as history
     from equipment_items i, app.equipment_place(i.id) p
    where i.id = $1`, [id])).rows[0];

const countNamed = async (name: string) => Number((await sql(
  "select count(*)::int as n from equipment_items where name = $1", [name])).rows[0].n);

const clearAll = async () => {
  const db = await admin();
  try {
    await db.query("begin");
    await db.query("alter table equipment_history disable trigger equipment_history_append_only");
    await db.query("alter table equipment_moves disable trigger equipment_moves_append_only");
    await db.query(`create temp table eq_gone on commit drop as
                      select id from equipment_items where name like 'EQTEST %'`);
    await db.query("delete from equipment_history where item_id in (select id from eq_gone)");
    await db.query(`create temp table eq_moves on commit drop as
                      select id, approval_id from equipment_moves where item_id in (select id from eq_gone)`);
    await db.query("delete from equipment_moves where id in (select id from eq_moves)");
    await db.query(`delete from approvals
                     where subject_id in (select id from eq_gone)
                        or subject_id in (select id from eq_moves)`);
    /* One statement: a split line points at its line, and the key is
       checked when the statement ends, by which time both are gone. */
    await db.query("delete from equipment_items where id in (select id from eq_gone)");
    await db.query("alter table equipment_moves enable trigger equipment_moves_append_only");
    await db.query("alter table equipment_history enable trigger equipment_history_append_only");
    await db.query("delete from equipment_categories where name like 'EQTEST%'");
    await db.query("delete from locations where name like 'EQTEST%'");
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
  store = (await sql(
    `insert into locations (hotel_id, name, kind) values ($1, 'EQTEST store', 'store')
     returning id::text`, [hotelId])).rows[0].id;

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
      const website = ROLES.filter((r) => grantsFor(r, "equipment").includes(action));
      expect([...EQUIPMENT_GRANTS[action]].sort()).toEqual([...website].sort());
    });
  }

  it("covers every action the website grants on equipment", () => {
    /* The owner holds every action on every resource by a blanket grant,
       which names `cancel` and `delete` without meaning either here. */
    const granted = new Set(
      ROLES.filter((r) => r !== "owner").flatMap((r) => [...grantsFor(r, "equipment")]));
    expect([...granted].filter((a) => !ACTIONS.includes(a as EquipmentAction))).toEqual([]);
  });

  it("names every role it lets in - the Inventory Manager by that name", () => {
    for (const action of ACTIONS) {
      for (const role of EQUIPMENT_GRANTS[action]) {
        expect(ROLE_NAMES[role], `${role} has no name in a refusal`).toBeTruthy();
      }
    }
    expect(refusedFor("create")).toBe(
      "Adding equipment is for the owner, an administrator, the general manager, "
      + "the hotel manager or the Inventory Manager. Ask one of them.");
    for (const action of ACTIONS) expect(refusedFor(action)).not.toMatch(/store manager/i);
  });

  it("offers no way to delete anything, even to the owner - a thing leaves by being retired", async () => {
    const { tagged } = fixtures.get("owner")!;
    const res = await call(ownerId, `/equipment/items/${tagged}`, "DELETE");
    expect(res.status).toBe(404);
    expect(await state(tagged)).toBeTruthy();
  });
});

/* ── Every role at every door ───────────────────────────────────────── */

const may = (role: string, action: EquipmentAction) =>
  (EQUIPMENT_GRANTS[action] as readonly string[]).includes(role);

const expectRefused = async (res: Response, action?: EquipmentAction) => {
  expect(res.status, await res.clone().text()).toBe(403);
  const body = (await res.json()) as { ok: boolean; reason: string };
  expect(body.ok).toBe(false);
  if (action) expect(body.reason).toBe(refusedFor(action));
  else expect(body.reason).toMatch(/is for the owner/);
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
        dryRun: false, rows: [{ name, heldAs: "count", quantity: "2", room }],
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

describe("changing, moving between rooms, and repairing (edit)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "edit") ? "lets" : "refuses"} ${role}`, async () => {
      const staff = staffByRole.get(role)!;
      const { tagged } = fixtures.get(role)!;
      const before = await state(tagged);

      const edit = await call(staff, `/equipment/items/${tagged}`, "PATCH",
        { name: `EQTEST ${role} tv renamed` });
      const move = await call(staff, `/equipment/items/${tagged}/move`, "POST", { roomId: roomB });
      const repair = await call(staff, `/equipment/items/${tagged}/status`, "POST",
        { status: "under_repair" });
      const after = await state(tagged);

      if (may(role, "edit")) {
        for (const res of [edit, move, repair]) expect(res.status, await res.clone().text()).toBe(200);
        expect(after.name).toBe(`EQTEST ${role} tv renamed`);
        expect(after.room_id).toBe(roomB);
        expect(after.status).toBe("under_repair");
      } else if (may(role, "view")) {
        await expectRefused(edit, "edit");
        await expectRefused(repair, "edit");
        /* A viewer may ASK for something to leave the store — not move it
           between rooms (the owner's answer, 16 September). */
        await expectRefused(move);
        expect(after, `${role} was refused and the item changed`).toEqual(before);
      } else {
        await expectRefused(edit, "edit");
        await expectRefused(repair, "edit");
        await expectRefused(move, "view");
        expect(after, `${role} was refused and the item changed`).toEqual(before);
      }
    });
  }
});

describe("asking for a thing to leave the store (view, S15)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "view") ? "lets" : "refuses"} ${role}`, async () => {
      const { stored } = fixtures.get(role)!;
      const res = await call(staffByRole.get(role)!, `/equipment/items/${stored}/move`, "POST",
        { roomId: roomA, note: `EQTEST ${role} wants it` });
      const after = await state(stored);

      if (may(role, "view")) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as { requested: boolean }).requested).toBe(true);
        /* Asked, and still in the store until somebody else approves. */
        expect(after.location_id).toBe(store);
        expect(after.requests).toBe(1);
      } else {
        await expectRefused(res, "view");
        expect(after.location_id).toBe(store);
        expect(after.moves, `${role} was refused and a move was written`).toBe(1);
        expect(after.requests, `${role} was refused and a request was raised`).toBe(0);
      }
    });
  }
});

describe("retiring part of a counted line (edit)", () => {
  for (const role of EVERY_ROLE) {
    it(`${may(role, "edit") ? "lets" : "refuses"} ${role}`, async () => {
      const { counted } = fixtures.get(role)!;
      const res = await call(staffByRole.get(role)!, `/equipment/items/${counted}/retire`, "POST",
        { reason: "EQTEST broken", count: 2 });
      const after = await state(counted);

      if (may(role, "edit")) {
        /* A counted line goes straight through, whoever retires it. */
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

describe("retiring a tagged item - at once, or in the inbox (S16)", () => {
  for (const role of EVERY_ROLE) {
    const outcome = !may(role, "edit") ? "refuses" : may(role, "approve") ? "retires at once for" : "sends to the inbox for";
    it(`${outcome} ${role}`, async () => {
      const { costly } = fixtures.get(role)!;
      const res = await call(staffByRole.get(role)!, `/equipment/items/${costly}/retire`, "POST",
        { reason: "EQTEST beyond repair" });
      const after = await state(costly);

      if (!may(role, "edit")) {
        await expectRefused(res, "edit");
        expect(after.retired).toBe(false);
        expect(after.requests, `${role} was refused and a request was raised`).toBe(0);
      } else if (may(role, "approve")) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as { requested: boolean }).requested).toBe(false);
        expect(after.retired).toBe(true);
        expect(after.requests).toBe(0);
      } else {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as { requested: boolean }).requested).toBe(true);
        expect(after.retired, "a Hotel Manager's retirement must wait").toBe(false);
        expect(after.requests).toBe(1);
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

  it("asks the role AT THIS HOTEL - a GM elsewhere is reception here", async () => {
    const name = "EQTEST gm elsewhere";
    const res = await call(gmElsewhereId, "/equipment", "POST",
      { name, heldAs: "counted", quantity: 1, roomId: roomA });
    await expectRefused(res, "create");
    expect(await countNamed(name)).toBe(0);
    expect((await call(gmElsewhereId, "/equipment")).status).toBe(200);
  });

  it("covers every role a person can be given", () => {
    expect([...staffByRole.keys()].sort()).toEqual([...EVERY_ROLE].sort());
  });
});
