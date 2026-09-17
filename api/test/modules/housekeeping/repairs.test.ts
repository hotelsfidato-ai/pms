import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import * as SERVER from "../../../src/modules/housekeeping/repairRoles.ts";
import { readAmount } from "../../../src/modules/housekeeping/repairs.ts";
import * as WEBSITE from "../../../../src/modules/housekeeping/repairRoles.ts";
import { ASSIGNABLE_ROLES } from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   REPAIRS ON EQUIPMENT, AND WHAT THEY COST — phase 2B, through the API

   The owner's answers of 17 September (docs/briefs/decisions-2026-09-17.md
   D17-5 to D17-7, and the questions asked the same morning):

     OPENING a repair on a tagged thing makes it "Under repair"; CLOSING the
       last open repair on it makes it "In use" — through the register's
       front door, in the repair's own transaction
     a COUNTED line, a RETIRED thing, and a thing WAITING in the approvals
       inbox are refused, each in a sentence, and nothing is written
     a COST needs its PROOF, a positive amount, and one of the five roles;
       one bill proves one cost; a wrong one is CANCELLED with a reason,
       never changed; the money is shown only to those five and the
       accountant
     "Report a repair" that takes the room out LINKS the block, and putting
       the room back clears the link

   ⚠ THE REFUSALS ARE THE POINT. Every role a person can be given is tried
   at each door, and a refusal is checked to have left nothing behind.

   Everything is named HKTEST-R and removed afterwards.
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

let hotelId: string;
let vacantRoom: { id: string; number: string };
let store: string;
const staff = new Map<string, string>();
const gm = () => staff.get("gm")!;

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function json<T = Record<string, unknown>>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A real 1×1 PNG, made unique by what follows its end — a proof per cost. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQ" +
  "GAhKmMIQAAAABJRU5ErkJggg==", "base64");
let bills = 0;
const bill = () => Buffer.concat([PNG, Buffer.from(`HKTEST-R bill ${++bills} ${Date.now()}`)]);

const recordCost = (who: string, form: { workOrderId?: string; amount?: string; note?: string;
                                          file?: Buffer | null; type?: string }) => {
  const body = new FormData();
  if (form.workOrderId !== undefined) body.set("workOrderId", form.workOrderId);
  if (form.amount !== undefined) body.set("amount", form.amount);
  if (form.note !== undefined) body.set("note", form.note);
  if (form.file) {
    body.set("file", new File([new Uint8Array(form.file)], "bill.png", { type: form.type ?? "image/png" }));
  }
  return app.request("/api/hotels/5EL/repair-costs", {
    method: "POST", headers: { "x-dev-staff-id": who }, body,
  });
};

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`hkr-${key}@fidato.in`, `HKTEST-R ${key}`, `test-uid-hkr-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
  return id;
};

const statusOf = async (itemId: string) =>
  (await sql("select status from equipment_items where id = $1", [itemId])).rows[0].status as string;

const add = async (body: Record<string, unknown>) =>
  (await json<{ id: string }>(await call(gm(), "/equipment", "POST", body))).id;

const raise = (who: string, body: Record<string, unknown>) =>
  call(who, "/work-orders", "POST", { category: "maintenance", priority: "normal", ...body });

const clear = async () => {
  const db = await admin();
  try {
    await db.query("begin");
    await db.query(`create temp table hk_orders on commit drop as
                      select id from work_orders where title like 'HKTEST-R %'`);
    await db.query(`create temp table hk_proofs on commit drop as
                      select proof_id as id from work_order_costs
                       where work_order_id in (select id from hk_orders)`);
    await db.query("delete from work_order_costs where work_order_id in (select id from hk_orders)");
    await db.query("delete from attachments where id in (select id from hk_proofs)");
    await db.query("update work_orders set block_id = null where id in (select id from hk_orders)");
    await db.query("delete from room_blocks where note like 'HKTEST-R %'");
    await db.query("delete from work_orders where id in (select id from hk_orders)");

    await db.query("alter table equipment_history disable trigger equipment_history_append_only");
    await db.query("alter table equipment_moves disable trigger equipment_moves_append_only");
    await db.query(`create temp table hk_gone on commit drop as
                      select id from equipment_items where name like 'HKTEST-R %'`);
    await db.query("delete from equipment_history where item_id in (select id from hk_gone)");
    await db.query(`create temp table hk_moves on commit drop as
                      select id from equipment_moves where item_id in (select id from hk_gone)`);
    await db.query("delete from equipment_moves where id in (select id from hk_moves)");
    await db.query(`delete from approvals where subject_id in (select id from hk_gone)
                                         or subject_id in (select id from hk_moves)`);
    await db.query("delete from equipment_items where id in (select id from hk_gone)");
    await db.query("alter table equipment_moves enable trigger equipment_moves_append_only");
    await db.query("alter table equipment_history enable trigger equipment_history_append_only");
    await db.query("delete from locations where name like 'HKTEST-R%'");
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
  /* A room nobody is in: a block is refused on an occupied one. */
  vacantRoom = (await sql(
    `select r.id::text, r.number from rooms r
      where r.hotel_id = $1 and r.is_active and r.housekeeping_status <> 'out_of_service'
        and not exists (select 1 from room_assignments ra
                          join reservations rs on rs.id = ra.reservation_id
                         where ra.room_id = r.id and ra.released_at is null
                           and rs.status = 'checked_in')
        and not exists (select 1 from room_blocks b where b.room_id = r.id)
      order by r.number limit 1`, [hotelId])).rows[0];
  await clear();
  store = (await sql(
    `insert into locations (hotel_id, name, kind) values ($1, 'HKTEST-R Main store', 'store')
     returning id::text`, [hotelId])).rows[0].id;
  for (const role of ASSIGNABLE_ROLES) staff.set(role, await person(role, role));
});

afterAll(async () => {
  await clear();
  const ids = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the two copies of who may", () => {
  it("are the same lists on the server and the website", () => {
    expect([...SERVER.REPAIR_REPORTERS].sort()).toEqual([...WEBSITE.REPAIR_REPORTERS].sort());
    expect([...SERVER.COST_RECORDERS].sort()).toEqual([...WEBSITE.COST_RECORDERS].sort());
    expect([...SERVER.COST_VIEWERS].sort()).toEqual([...WEBSITE.COST_VIEWERS].sort());
  });

  it("are the owner's words: D17-5 records, and the accountant only looks", () => {
    expect([...SERVER.COST_RECORDERS].sort())
      .toEqual(["admin", "gm", "hotel_manager", "owner", "stores"]);
    expect([...SERVER.COST_VIEWERS].sort())
      .toEqual(["admin", "finance", "gm", "hotel_manager", "owner", "stores"]);
  });
});

describe("reading an amount", () => {
  it("takes rupees as typed, and never a zero or a guess", () => {
    expect(readAmount("1,250.50")).toBe(1250.5);
    expect(readAmount("₹ 800")).toBe(800);
    expect(readAmount("0")).toBeNull();
    expect(readAmount("")).toBeNull();
    expect(readAmount("12.345")).toBeNull();
    expect(readAmount("-5")).toBeNull();
    expect(readAmount("eight hundred")).toBeNull();
  });
});

describe("a repair on a piece of equipment (D17-7)", () => {
  it("makes the thing Under repair when raised, and In use when the last repair on it closes", async () => {
    const ac = await add({ name: "HKTEST-R AC", heldAs: "tagged", tag: "HKTEST-R-AC1", roomId: vacantRoom.id });
    expect(await statusOf(ac)).toBe("in_use");

    const first = await json<{ id: string }>(await raise(staff.get("housekeeping")!,
      { title: "HKTEST-R AC not cooling", roomNumber: vacantRoom.number, equipmentItemId: ac }));
    expect(await statusOf(ac)).toBe("under_repair");

    /* The item's own history says why, and who — the register's record. */
    const { rows: hist } = await sql(
      `select note, done_by::text from equipment_history
        where item_id = $1 and kind = 'status' order by done_at desc, id desc limit 1`, [ac]);
    expect(hist[0].note).toBe("Repair raised: HKTEST-R AC not cooling");
    expect(hist[0].done_by).toBe(staff.get("housekeeping"));

    const second = await json<{ id: string }>(await raise(gm(),
      { title: "HKTEST-R AC remote missing", equipmentItemId: ac }));

    await json(await call(gm(), `/work-orders/${first.id}`, "PATCH",
      { status: "done", resolution: "Gas refilled" }));
    expect(await statusOf(ac), "another repair on it is still open").toBe("under_repair");

    await json(await call(gm(), `/work-orders/${second.id}`, "PATCH",
      { status: "cancelled", resolution: "Remote found in the drawer" }));
    expect(await statusOf(ac)).toBe("in_use");
  });

  it("refuses closing a repair twice — who closed it and what they said stay", async () => {
    const tv = await add({ name: "HKTEST-R TV", heldAs: "tagged", tag: "HKTEST-R-TV1", roomId: vacantRoom.id });
    const { id } = await json<{ id: string }>(await raise(gm(), { title: "HKTEST-R TV no signal", equipmentItemId: tv }));
    await json(await call(gm(), `/work-orders/${id}`, "PATCH", { status: "done", resolution: "Cable reseated" }));
    const again = await json<{ reason: string }>(await call(staff.get("hotel_manager")!,
      `/work-orders/${id}`, "PATCH", { status: "done", resolution: "Something else" }), 409);
    expect(again.reason).toBe("This repair is already closed.");
    const { rows } = await sql("select resolution, closed_by::text from work_orders where id = $1", [id]);
    expect(rows[0]).toEqual({ resolution: "Cable reseated", closed_by: gm() });
  });

  it("refuses a counted line, and writes nothing", async () => {
    const kettles = await add({ name: "HKTEST-R Kettle", heldAs: "counted", quantity: 4, roomId: vacantRoom.id });
    const body = await json<{ reason: string }>(await raise(gm(),
      { title: "HKTEST-R Kettle leaking", equipmentItemId: kettles }), 409);
    expect(body.reason).toBe("A repair points at one tagged item. A counted line is retired or replaced, not repaired.");
    expect((await sql("select count(*)::int as n from work_orders where title = 'HKTEST-R Kettle leaking'")).rows[0].n).toBe(0);
    expect(await statusOf(kettles)).toBe("in_use");
  });

  it("refuses a retired thing", async () => {
    const lamp = await add({ name: "HKTEST-R Lamp", heldAs: "tagged", tag: "HKTEST-R-LA1", roomId: vacantRoom.id });
    await json(await call(gm(), `/equipment/items/${lamp}/retire`, "POST", { reason: "HKTEST-R broken" }));
    const body = await json<{ reason: string }>(await raise(gm(),
      { title: "HKTEST-R Lamp flickers", equipmentItemId: lamp }), 409);
    expect(body.reason).toBe("A retired item is kept exactly as it was retired.");
    expect((await sql("select count(*)::int as n from work_orders where title = 'HKTEST-R Lamp flickers'")).rows[0].n).toBe(0);
  });

  it("refuses a thing waiting in the approvals inbox — the owner's answer — and writes nothing", async () => {
    const fridge = await add({ name: "HKTEST-R Fridge", heldAs: "tagged", tag: "HKTEST-R-FR1", locationId: store });
    await json(await call(staff.get("housekeeping")!, `/equipment/items/${fridge}/move`, "POST",
      { roomId: vacantRoom.id, note: "HKTEST-R the guest needs one" }));

    const body = await json<{ reason: string }>(await raise(staff.get("housekeeping")!,
      { title: "HKTEST-R Fridge door loose", equipmentItemId: fridge }), 409);
    expect(body.reason).toBe(
      "A request for this item is waiting in the approvals inbox. It is decided there first.");
    expect((await sql("select count(*)::int as n from work_orders where title = 'HKTEST-R Fridge door loose'")).rows[0].n).toBe(0);
    expect(await statusOf(fridge)).toBe("in_use");
  });

  it("offers only tagged things that are not retired", async () => {
    const { items, mayReport } = await json<{ items: { name: string }[]; mayReport: boolean }>(
      await call(staff.get("chef")!, "/repairable-equipment"));
    expect(mayReport).toBe(true);
    const names = items.map((i) => i.name).filter((n) => n.startsWith("HKTEST-R "));
    expect(names).toContain("HKTEST-R AC");
    expect(names).not.toContain("HKTEST-R Kettle");
    expect(names).not.toContain("HKTEST-R Lamp");
  });

  for (const role of ["owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk",
                      "housekeeping", "kitchen_manager", "chef", "pos", "stores", "finance",
                      "read_only"]) {
    const mayReport = (WEBSITE.REPAIR_REPORTERS as readonly string[]).includes(role);
    it(`${mayReport ? "lets" : "refuses"} ${role} ${mayReport ? "report" : "reporting"} a repair on equipment`, async () => {
      const oven = await add({ name: `HKTEST-R Oven ${role}`, heldAs: "tagged",
                               tag: `HKTEST-R-OV-${role}`, roomId: vacantRoom.id });
      const res = await raise(staff.get(role)!, { title: `HKTEST-R Oven ${role} broken`, equipmentItemId: oven });
      const written = (await sql("select count(*)::int as n from work_orders where title = $1",
        [`HKTEST-R Oven ${role} broken`])).rows[0].n;
      if (mayReport) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(written).toBe(1);
        expect(await statusOf(oven)).toBe("under_repair");
      } else {
        expect(res.status, await res.clone().text()).toBe(403);
        expect(((await res.json()) as { reason: string }).reason).toMatch(/Inventory Manager/);
        expect(written, `${role} was refused and a repair was written anyway`).toBe(0);
        expect(await statusOf(oven)).toBe("in_use");
      }
    });
  }
});

describe("a repair cost, with its proof (D17-5, D17-6)", () => {
  let order: string;
  beforeAll(async () => {
    order = (await json<{ id: string }>(await raise(gm(), { title: "HKTEST-R Geyser element" }))).id;
  });
  const costs = async () => (await sql(
    "select amount::text, cancelled_at is not null as cancelled from work_order_costs where work_order_id = $1 order by recorded_at",
    [order])).rows;

  it("refuses a cost with no proof, in a sentence, and writes nothing", async () => {
    const body = await json<{ reason: string }>(
      await recordCost(gm(), { workOrderId: order, amount: "1800", file: null }), 409);
    expect(body.reason).toMatch(/^Attach the proof: a photo or screenshot of the bill, the payment or the transaction\./);
    expect(await costs()).toHaveLength(0);
  });

  it("refuses a zero, a word and a missing amount", async () => {
    for (const amount of ["0", "eighteen hundred", ""]) {
      const body = await json<{ reason: string }>(
        await recordCost(gm(), { workOrderId: order, amount, file: bill() }), 409);
      expect(body.reason).toMatch(/How much was it\?/);
    }
    expect(await costs()).toHaveLength(0);
  });

  it("refuses a file that is not a photo or a PDF", async () => {
    const body = await json<{ reason: string }>(await recordCost(gm(),
      { workOrderId: order, amount: "1800", file: Buffer.from("not a bill"), type: "text/plain" }), 409);
    expect(body.reason).toMatch(/JPEG, PNG, WebP, HEIC or PDF/);
    expect(await costs()).toHaveLength(0);
  });

  for (const role of ["owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk",
                      "housekeeping", "kitchen_manager", "chef", "pos", "stores", "finance",
                      "read_only"]) {
    const may = (WEBSITE.COST_RECORDERS as readonly string[]).includes(role);
    it(`${may ? "lets" : "refuses"} ${role} ${may ? "record" : "recording"} a cost`, async () => {
      const before = (await costs()).length;
      const res = await recordCost(staff.get(role)!, { workOrderId: order, amount: "250", file: bill() });
      if (may) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await costs()).toHaveLength(before + 1);
      } else {
        expect(res.status, await res.clone().text()).toBe(403);
        expect(((await res.json()) as { reason: string }).reason).toMatch(/Inventory Manager/);
        expect(await costs(), `${role} was refused and a cost was written anyway`).toHaveLength(before);
      }
    });
  }

  it("keeps the proof against the cost, and refuses the same bill for a second cost", async () => {
    const one = bill();
    const first = await json<{ id: string }>(
      await recordCost(staff.get("stores")!, { workOrderId: order, amount: "1,800.50", note: "Element", file: one }));
    const { rows } = await sql(
      `select a.subject_table, a.subject_id::text, k.amount::text
         from work_order_costs k join attachments a on a.id = k.proof_id where k.id = $1`, [first.id]);
    expect(rows[0]).toEqual({ subject_table: "work_order_costs", subject_id: first.id, amount: "1800.50" });

    const again = await json<{ reason: string }>(
      await recordCost(gm(), { workOrderId: order, amount: "1800.50", file: one }), 409);
    expect(again.reason).toBe('That file is already the proof of a cost on "HKTEST-R Geyser element". One bill proves one cost.');
  });

  it("the database refuses a cost row whose proof is not its own", async () => {
    const other = (await sql(
      "select proof_id::text from work_order_costs where work_order_id = $1 limit 1", [order])).rows[0].proof_id;
    await expect(sql(
      `insert into work_order_costs (hotel_id, work_order_id, amount, proof_id, recorded_by)
       values ($1, $2, 10, $3, $4)`, [hotelId, order, other, gm()]))
      .rejects.toThrow(/recorded with its proof/);
  });

  it("cancels a wrong cost only with a reason, once, and takes it out of the total", async () => {
    const wrong = await json<{ id: string }>(
      await recordCost(gm(), { workOrderId: order, amount: "99999", file: bill() }));

    const listed = async (who: string) => (await json<{
      orders: { id: string; costTotal?: number | null; costs?: { id: string; cancelled: unknown }[] }[];
    }>(await call(who, "/work-orders"))).orders.find((o) => o.id === order)!;

    const totalBefore = (await listed(gm())).costTotal!;
    expect(totalBefore).toBeGreaterThan(99999);

    const noReason = await json<{ reason: string }>(
      await call(gm(), `/repair-costs/${wrong.id}/cancel`, "POST", { reason: " " }), 409);
    expect(noReason.reason).toMatch(/Why is it cancelled\?/);

    const refused = await call(staff.get("finance")!, `/repair-costs/${wrong.id}/cancel`, "POST", { reason: "typo" });
    expect(refused.status).toBe(403);

    await json(await call(gm(), `/repair-costs/${wrong.id}/cancel`, "POST", { reason: "Typed an extra 9" }));
    const twice = await json<{ reason: string }>(
      await call(gm(), `/repair-costs/${wrong.id}/cancel`, "POST", { reason: "again" }), 409);
    expect(twice.reason).toBe("That cost is already cancelled.");

    const after = await listed(gm());
    expect(after.costTotal).toBe(Math.round((totalBefore - 99999) * 100) / 100);
    expect(after.costs!.find((k) => k.id === wrong.id)!.cancelled).toMatchObject({ reason: "Typed an extra 9" });

    await expect(sql("update work_order_costs set amount = 1 where id = $1", [wrong.id]))
      .rejects.toThrow(/cancelled cost stays exactly as it was cancelled/);
    /* Never deleted: the application holds no DELETE on the table. */
    const { rows: grant } = await sql(
      "select has_table_privilege('pms_app', 'work_order_costs', 'DELETE') as may");
    expect(grant[0].may).toBe(false);
  });

  it("shows the money to the five and the accountant, and to nobody else — not even as an empty list", async () => {
    for (const role of ASSIGNABLE_ROLES) {
      const res = await call(staff.get(role)!, "/work-orders");
      if (res.status !== 200) continue;
      const body = (await res.json()) as { orders: Record<string, unknown>[]; maySeeCosts: boolean };
      const row = body.orders.find((o) => o["id"] === order);
      const sees = (WEBSITE.COST_VIEWERS as readonly string[]).includes(role);
      expect(body.maySeeCosts, role).toBe(sees);
      if (row) {
        expect("costs" in row, `${role} ${sees ? "should" : "should not"} see costs`).toBe(sees);
        expect("costTotal" in row, role).toBe(sees);
      }
    }
  });

  it("gives a repair with no standing cost a null total — a dash, never ₹0", async () => {
    const { id } = await json<{ id: string }>(await raise(gm(), { title: "HKTEST-R Door squeaks" }));
    const row = (await json<{ orders: { id: string; costTotal: number | null; costs: unknown[] }[] }>(
      await call(gm(), "/work-orders"))).orders.find((o) => o.id === id)!;
    expect(row.costs).toEqual([]);
    expect(row.costTotal).toBeNull();
  });

  it("lists closed repairs newest first, where a late bill can still be recorded", async () => {
    const { id } = await json<{ id: string }>(await raise(gm(), { title: "HKTEST-R Window latch" }));
    await json(await call(gm(), `/work-orders/${id}`, "PATCH", { status: "done", resolution: "Latch replaced" }));
    const closed = await json<{ view: string; orders: { id: string; resolution: string | null }[] }>(
      await call(gm(), "/work-orders?view=closed"));
    expect(closed.view).toBe("closed");
    expect(closed.orders[0]!.id).toBe(id);
    expect(closed.orders[0]!.resolution).toBe("Latch replaced");
    await json(await recordCost(staff.get("hotel_manager")!, { workOrderId: id, amount: "320", file: bill() }));
  });
});

describe("a repair that takes the room out", () => {
  it("links the block to the repair, and putting the room back clears it", async () => {
    const { id } = await json<{ id: string }>(await raise(staff.get("housekeeping")!,
      { title: "HKTEST-R Ceiling leak", roomNumber: vacantRoom.number }));

    const block = await json<{ id: string }>(await call(staff.get("housekeeping")!,
      `/rooms/${vacantRoom.number}/block`, "POST",
      { reason: "out_of_order", from: "2020-01-01", note: "HKTEST-R leak", workOrderId: id }));

    const listed = (await json<{ orders: { id: string; blocksRoom: boolean }[] }>(
      await call(gm(), "/work-orders"))).orders.find((o) => o.id === id)!;
    expect(listed.blocksRoom).toBe(true);

    const twice = await json<{ reason: string }>(await call(gm(),
      `/rooms/${vacantRoom.number}/block`, "POST",
      { reason: "out_of_order", from: "2020-01-01", note: "HKTEST-R again", workOrderId: id }), 409);
    expect(twice.reason).toBe("That repair has already taken the room out.");
    expect((await sql("select count(*)::int as n from room_blocks where note = 'HKTEST-R again'")).rows[0].n).toBe(0);

    await json(await call(gm(), `/rooms/${vacantRoom.number}/block/${block.id}`, "DELETE"));
    const { rows } = await sql("select block_id from work_orders where id = $1", [id]);
    expect(rows[0].block_id).toBeNull();
  });
});
