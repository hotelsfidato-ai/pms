import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { STOCK_ROLES as SERVER_LISTS } from "../../../src/modules/stores/stockGrants.ts";
import {
  ROLES, ASSIGNABLE_ROLES, grantsFor,
} from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY CHANGE THE STORE — STO-1

   Until 16 September no store route asked the caller's role, so reception
   and the Viewer could add an item, receive at a cost, undo a delivery and
   import a list. The owner's table (docs/STOCK-AND-EQUIPMENT-PLAN.md § 6)
   is `grantsFor(role, "stock")`: view to look, create for a new item and
   every new movement, edit for a correction, an undo, or a change to an
   item already in the store.

   This file tries EVERY store act as EVERY role a person can be given,
   and for each refusal proves nothing was written.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the GM can write
   passes with no guard at all.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "STO1TEST";
const HOTEL = "5EL";

let ownerId: string;
let shelfId: string;
let gmElsewhereId: string;
/** The hotel's Main store and Kitchen store (104), where every movement here happens. */
let mainId: string;
let kitchenId: string;
const staffByRole = new Map<string, string>();
/** Per role: a delivery for that role to try to undo. */
const targetByRole = new Map<string, string>();

const call = (staffId: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}/stores${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const one = async (text: string, params: unknown[]) =>
  (await sql(text, params)).rows[0] as Record<string, unknown> | undefined;

const itemNamed = (name: string) => one(
  `select i.unit from stock_items i join hotels h on h.id = i.hotel_id
    where h.code = $1 and i.name = $2`, [HOTEL, name]);

const movementsNoted = async (note: string) => Number((await one(
  "select count(*)::int as n from stock_movements where note = $1", [note]))!.n);

const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`sto1-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-sto1-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const r of roles) {
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = $3`, [id, r.role, r.hotel]);
  }
  return id;
};

const refused = async (res: Response, why: string) => {
  expect(res.status, `${why}: ${await res.clone().text()}`).toBe(403);
  const body = (await res.json()) as { ok: boolean; reason: string };
  expect(body.ok).toBe(false);
  /* Rule 6: who CAN, so the person knows whom to ask. */
  expect(body.reason).toMatch(/general manager/i);
};

const ok = async (res: Response, why: string) => {
  expect(res.status, `${why}: ${await res.clone().text()}`).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
};

beforeAll(async () => {
  ownerId = (await one(
    "select id::text from staff where email = 'owner@fidato.in'", []))!.id as string;

  for (const role of ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: HOTEL, role }]));
  }
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: HOTEL, role: "front_desk" },
  ]);

  const storeNamed = async (name: string) => (await one(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = $2`, [HOTEL, name]))!.id as string;
  mainId = await storeNamed("Main store");
  kitchenId = await storeNamed("Kitchen store");

  /* The shelf every out-movement draws from, stocked by the owner. */
  const shelf = await ok(await call(ownerId, "POST", "/items",
    { name: `${TAG} shelf`, unit: "piece" }), "the owner adds the shelf item");
  shelfId = shelf.id as string;
  await ok(await call(ownerId, "POST", "/movements",
    { itemId: shelfId, locationId: mainId, kind: "receipt", quantity: 10000, unitCost: 1, note: `${TAG} opening` }),
    "the owner stocks the shelf");

  for (const role of ASSIGNABLE_ROLES) {
    /* A delivery for this role to try to undo, and an item for it to try
       to change — one each, so one role's success cannot hide another's. */
    const target = await ok(await call(ownerId, "POST", "/movements",
      { itemId: shelfId, locationId: mainId, kind: "receipt", quantity: 1, unitCost: 1, note: `${TAG} target ${role}` }),
      `the owner receives ${role}'s target`);
    targetByRole.set(role, target.id as string);
    await ok(await call(ownerId, "POST", "/items",
      { name: `${TAG} existing ${role}`, unit: "kg" }), `the owner adds ${role}'s existing item`);
  }
});

afterAll(async () => {
  const ids = [...staffByRole.values(), gmElsewhereId];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the server's lists of who may do what in the Store", () => {
  for (const action of ["view", "create", "edit"] as const) {
    it(`${action}: is the website's grant, exactly`, () => {
      /* Two copies of one rule, held together here. When the owner's table
         changes in src/lib/permissions.ts, this fails until
         api/src/modules/stores/stockGrants.ts says the same. */
      const website = ROLES.filter((r) => grantsFor(r, "stock").includes(action));
      expect([...SERVER_LISTS[action]].sort()).toEqual([...website].sort());
    });
  }
});

describe("the Store, as every role a person can be given (STO-1)", () => {
  for (const role of ["owner", "admin", "gm", "hotel_manager", "revenue_manager",
                      "front_desk", "housekeeping", "kitchen_manager", "chef", "pos",
                      "stores", "finance", "read_only"]) {
    const grants = grantsFor(role as never, "stock");
    const view = grants.includes("view");
    const create = grants.includes("create");
    const edit = grants.includes("edit");
    const who = () => staffByRole.get(role)!;

    describe(role, () => {
      it(`${view ? "may" : "may not"} read the list and an item's history`, async () => {
        const list = await call(who(), "GET", "");
        const history = await call(who(), "GET", `/items/${shelfId}/movements`);
        if (view) {
          const body = await ok(list, "the list");
          expect((body.items as { name: string }[]).some((i) => i.name === `${TAG} shelf`)).toBe(true);
          await ok(history, "the history");
        } else {
          await refused(list, "the list");
          await refused(history, "the history");
        }
      });

      it(`${create ? "may" : "may not"} add a new item`, async () => {
        const name = `${TAG} new ${role}`;
        const res = await call(who(), "POST", "/items", { name, unit: "piece" });
        if (create) {
          await ok(res, "adding");
          expect(await itemNamed(name)).toBeDefined();
        } else {
          await refused(res, "adding");
          expect(await itemNamed(name), `${role} was refused and the item exists anyway`)
            .toBeUndefined();
        }
      });

      it(`${create && edit ? "may" : "may not"} change an existing item by adding its name again`, async () => {
        const name = `${TAG} existing ${role}`;
        const res = await call(who(), "POST", "/items", { name, unit: "g" });
        if (create && edit) {
          await ok(res, "changing");
          expect((await itemNamed(name))!.unit).toBe("g");
        } else {
          await refused(res, "changing");
          expect((await itemNamed(name))!.unit, `${role} was refused and the unit changed anyway`)
            .toBe("kg");
        }
      });

      for (const kind of ["receipt", "issue", "wastage", "return", "adjustment"] as const) {
        const may = kind === "adjustment" ? edit : create;
        it(`${may ? "may" : "may not"} record a ${kind}`, async () => {
          const note = `${TAG} ${kind} ${role}`;
          const res = await call(who(), "POST", "/movements", {
            itemId: shelfId, locationId: mainId, kind, quantity: 1, note,
            ...(kind === "receipt" ? { unitCost: 2 } : {}),
            ...(kind === "issue" ? { outletId: null } : {}),   // not an outlet (D22-20)
          });
          if (may) {
            await ok(res, kind);
            expect(await movementsNoted(note)).toBe(1);
          } else {
            await refused(res, kind);
            expect(await movementsNoted(note), `${role} was refused and a ${kind} was written anyway`)
              .toBe(0);
          }
        });
      }

      /* A move between stores is a new movement: `create` (the owner, 17
         September), so the kitchen manager may, and a look-only person may not. */
      it(`${create ? "may" : "may not"} move stock from one store to another`, async () => {
        const note = `${TAG} move ${role}`;
        const res = await call(who(), "POST", "/transfers", {
          itemId: shelfId, fromId: mainId, toId: kitchenId, quantity: 1, note,
        });
        if (create) {
          await ok(res, "moving");
          expect(await movementsNoted(note)).toBe(2);
        } else {
          await refused(res, "moving");
          expect(await movementsNoted(note), `${role} was refused and a move was written anyway`)
            .toBe(0);
        }
      });

      it(`${edit ? "may" : "may not"} undo a delivery`, async () => {
        const target = targetByRole.get(role)!;
        const res = await call(who(), "POST", `/movements/${target}/reverse`, { note: `${TAG} undo ${role}` });
        const undone = async () => Number((await one(
          "select count(*)::int as n from stock_movements where reverses_id = $1", [target]))!.n);
        if (edit) {
          await ok(res, "undoing");
          expect(await undone()).toBe(1);
        } else {
          await refused(res, "undoing");
          expect(await undone(), `${role} was refused and the delivery was undone anyway`).toBe(0);
        }
      });

      it(`${create && edit ? "may" : "may not"} add a new item with a warning level`, async () => {
        const name = `${TAG} levelled ${role}`;
        const res = await call(who(), "POST", "/items", { name, unit: "piece", reorderLevel: 3 });
        if (create && edit) {
          await ok(res, "adding with a level");
          expect(await itemNamed(name)).toBeDefined();
        } else {
          /* A level is edit on a new item too (D25-13): the kitchen manager adds
             without one, and a request with one is refused whole. */
          await refused(res, "adding with a level");
          expect(await itemNamed(name), `${role} was refused and the item exists anyway`)
            .toBeUndefined();
        }
      });

      /* A LEVEL AND A COUNT ARE `edit` (D25-13; the plan § 6 gives counting to
         the people who correct a count). */
      it(`${edit ? "may" : "may not"} set a store's level`, async () => {
        const res = await call(who(), "PATCH", `/items/${shelfId}`, { levels: { [kitchenId]: 5 } });
        const set = async () => Number((await one(
          "select count(*)::int as n from stock_levels where item_id = $1 and set_by = $2",
          [shelfId, who()]))!.n);
        if (edit) {
          await ok(res, "setting a level");
          expect(await set()).toBe(1);
        } else {
          await refused(res, "setting a level");
          expect(await set(), `${role} was refused and a level was set anyway`).toBe(0);
        }
      });

      it(`${edit ? "may" : "may not"} save a count`, async () => {
        const reason = `${TAG} count ${role}`;
        const book = Number((await one(
          "select app.stock_on_hand($1, $2)::float as n", [shelfId, mainId]))!.n);
        const res = await call(who(), "POST", "/counts", {
          locationId: mainId, lines: [{ itemId: shelfId, book, counted: book - 1, reason }] });
        if (edit) {
          await ok(res, "counting");
          expect(await movementsNoted(`Count of Main store - ${reason}`)).toBe(1);
        } else {
          await refused(res, "counting");
          expect(await movementsNoted(`Count of Main store - ${reason}`),
            `${role} was refused and a count was written anyway`).toBe(0);
        }
      });

      it(`${create ? "may" : "may not"} import a new item`, async () => {
        const name = `${TAG} imported ${role}`;
        const rows = [{ name, unit: "box" }];
        const dry = await call(who(), "POST", "/import", { rows, dryRun: true });
        const res = await call(who(), "POST", "/import", { rows, dryRun: false });
        if (create) {
          await ok(dry, "the dry run");
          await ok(res, "importing");
          expect(await itemNamed(name)).toBeDefined();
        } else {
          await refused(dry, "the dry run");
          await refused(res, "importing");
          expect(await itemNamed(name), `${role} was refused and the item was imported anyway`)
            .toBeUndefined();
        }
      });

      it(`${create && edit ? "may" : "may not"} change an existing item from a file`, async () => {
        const name = `${TAG} existing ${role}`;
        const before = (await itemNamed(name))!.unit;
        const rows = [{ name, unit: "litre" }];
        const res = await call(who(), "POST", "/import", { rows, dryRun: false });
        if (create && edit) {
          await ok(res, "importing a change");
          expect((await itemNamed(name))!.unit).toBe("litre");
        } else if (create) {
          /* SPLIT BY ROW (the owner, 16 September): the file is accepted, the
             row that would change an item is rejected with the reason, and
             the item is untouched. */
          const body = await ok(res, "importing a change");
          const verdicts = body.verdicts as { action: string; detail: string }[];
          expect(verdicts.map((v) => v.action)).toEqual(["rejected"]);
          expect(verdicts[0]!.detail).toMatch(/Inventory Manager/);
          expect((await itemNamed(name))!.unit, `${role} may not edit and the unit changed anyway`)
            .toBe(before);
        } else {
          await refused(res, "importing a change");
          expect((await itemNamed(name))!.unit).toBe(before);
        }
      });
    });
  }

  it("asks the role AT THIS HOTEL — a GM elsewhere is reception here", async () => {
    const note = `${TAG} receipt gm-elsewhere`;
    await refused(await call(gmElsewhereId, "GET", ""), "the list");
    await refused(await call(gmElsewhereId, "POST", "/movements",
      { itemId: shelfId, locationId: mainId, kind: "receipt", quantity: 1, unitCost: 1, note }), "receiving");
    expect(await movementsNoted(note)).toBe(0);
  });

  it("covers every role a person can be given", () => {
    /* The loop above names the roles by hand so a reader sees them. This
       stops a new role slipping past it untested. */
    expect([...staffByRole.keys()].sort()).toEqual(
      ["owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk",
       "housekeeping", "kitchen_manager", "chef", "pos", "stores", "finance",
       "read_only"].sort());
  });
});
