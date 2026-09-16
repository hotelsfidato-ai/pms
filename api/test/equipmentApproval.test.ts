import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { ASSIGNABLE_ROLES } from "../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   EQUIPMENT LEAVING THE STORE — WHO MAY DECIDE (migration 095)

   The owner's decisions, 16 September:
     S12  equipment going out of the store waits for approval
     S13  the Inventory Manager (the `stores` role) approves
     S14  when they are away, the owner, an administrator or the GM may
     S15  anybody who can see equipment may ask

   Before 095 an approval had one decider and the group owner, so a GM
   could not step in. These tests try EVERY role a person can be given,
   because a file that only proves the GM may decide passes just as well
   when the hotel manager, the chef and the till may decide too.

   The request is raised out of band, as `approvals.test.ts` does — the
   equipment register that raises it for real is phase 1B.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const MAY_DECIDE = ["stores", "owner", "admin", "gm"];
const TAG = "EQAPTEST";

let hotelId: string;
const person = new Map<string, { id: string; uid: string }>();

const as = (uid: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": uid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Somebody asks for a kettle to leave the store — or, with kind
    `equipment_retire`, for a tagged TV to be retired. */
async function raise(askerRole: string, kind = "equipment_issue"): Promise<string> {
  const { rows } = await sql(
    `select app.request_approval($1::uuid, $4, 'equipment_moves',
            gen_random_uuid(), $2, null, $3::uuid)::text as id`,
    [hotelId, `${TAG} a kettle for room 104`, person.get(askerRole)!.id, kind]);
  return rows[0].id as string;
}

type Row = { id: string; approverRole: string; alsoDecidedBy: string[];
             mayDecide: boolean; blockedBecause?: string;
             requestedBy: string | null; decidedBy: string | null };

async function seenBy(role: string, id: string): Promise<Row> {
  const res = await as(person.get(role)!.uid, "/5EL/approvals");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: Row[] };
  return body.rows.find((r) => r.id === id)!;
}

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;

  for (const role of ASSIGNABLE_ROLES) {
    const uid = `test-uid-eqap-${role}`;
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid)
       values ($1, $2, $3)
       on conflict (email) do update set is_active = true, firebase_uid = excluded.firebase_uid
       returning id::text`,
      [`eqap-${role}@fidato.in`, `${TAG} ${role}`, uid]);
    const id = rows[0].id as string;
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
      [id, hotelId, role]);
    person.set(role, { id, uid });
  }
});

afterAll(async () => {
  await sql("delete from approvals where reason like $1", [`${TAG}%`]);
  const ids = [...person.values()].map((p) => p.id);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("equipment leaving the store (095)", () => {
  it("is for the Inventory Manager, with the owner, admin and GM behind them", async () => {
    const id = await raise("front_desk");
    const row = await seenBy("gm", id);
    expect(row.approverRole).toBe("stores");
    expect([...row.alsoDecidedBy].sort()).toEqual(["admin", "gm", "owner"]);
  });

  for (const role of ASSIGNABLE_ROLES) {
    const may = MAY_DECIDE.includes(role);

    it(`${may ? "lets" : "refuses"} ${role} ${may ? "decide" : "deciding"}`, async () => {
      /* Asked by housekeeping, so nobody below is refused for having
         asked — except housekeeping itself, which the next test covers. */
      const asker = role === "housekeeping" ? "front_desk" : "housekeeping";
      const id = await raise(asker);

      const row = await seenBy(role, id);
      expect(row.mayDecide, `${role} is offered the button`).toBe(may);

      const res = await as(person.get(role)!.uid, `/5EL/approvals/${id}/approved`, "POST", {});
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (may) {
        expect(res.status, body.reason).toBe(200);
      } else {
        expect(res.status).toBe(409);
        expect(body.ok).toBe(false);
        expect(body.reason).toContain("to decide");
        /* and the refusal left it waiting */
        expect((await seenBy("gm", id)).mayDecide).toBe(true);
      }
    });
  }

  it("shows the Inventory Manager a request somebody else raised, WITH who asked", async () => {
    /* The queue used to INNER JOIN staff for the requester's name, and staff
       is row-secured — so the Inventory Manager's queue was empty (MEMORY
       283). Then it showed the row with a dash for the name; the owner's
       answer on 16 September was to show the name to the people who decide. */
    const id = await raise("housekeeping");
    const row = await seenBy("stores", id);
    expect(row, "the request is in the Inventory Manager's queue").toBeDefined();
    expect(row.mayDecide).toBe(true);
    expect(row.requestedBy).toBe(`${TAG} housekeeping`);
  });

  it("does not give the name to somebody who neither asked nor decides", async () => {
    const id = await raise("housekeeping");
    const row = await seenBy("chef", id);
    expect(row.mayDecide).toBe(false);
    expect(row.requestedBy).toBeNull();
  });

  it("tells the person who asked who decided, by name", async () => {
    const id = await raise("housekeeping");
    const res = await as(person.get("stores")!.uid, `/5EL/approvals/${id}/rejected`, "POST",
      { note: "The one in the store is kept for room 110." });
    expect(res.status).toBe(200);
    const mine = await as(person.get("housekeeping")!.uid, "/5EL/approvals?status=all");
    const row = ((await mine.json()) as { rows: Row[] }).rows.find((r) => r.id === id)!;
    expect(row.decidedBy).toBe(`${TAG} stores`);
  });

  it("puts a retirement in the same inbox, for the same people (096)", async () => {
    const id = await raise("hotel_manager", "equipment_retire");
    expect((await seenBy("stores", id)).mayDecide).toBe(true);
    expect((await seenBy("gm", id)).mayDecide).toBe(true);
    expect((await seenBy("kitchen_manager", id)).mayDecide).toBe(false);
    const res = await as(person.get("stores")!.uid, `/5EL/approvals/${id}/approved`, "POST", {});
    expect(res.status).toBe(200);
  });

  it("does not let the Inventory Manager approve what they asked for — the GM does", async () => {
    const id = await raise("stores");

    const own = await seenBy("stores", id);
    expect(own.mayDecide).toBe(false);
    const refused = await as(person.get("stores")!.uid, `/5EL/approvals/${id}/approved`, "POST", {});
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toContain("You asked for this one");

    const approved = await as(person.get("gm")!.uid, `/5EL/approvals/${id}/approved`, "POST", {});
    expect(approved.status).toBe(200);
  });

  it("changes nothing about a purchase: the GM still cannot decide one the owner's rule sends to the owner", async () => {
    await sql(
      `insert into approval_rules (hotel_id, kind, approver_role, over_amount)
       values ($1, 'purchase', 'owner', null)
       on conflict (hotel_id, kind, approver_role) do update set is_active = true, over_amount = null`,
      [hotelId]);
    try {
      const { rows } = await sql(
        `select app.request_approval($1::uuid, 'purchase', 'purchase_invoices',
                gen_random_uuid(), $2, 4200, $3::uuid)::text as id`,
        [hotelId, `${TAG} vegetables`, person.get("stores")!.id]);
      const id = rows[0].id as string;

      expect((await seenBy("gm", id)).mayDecide).toBe(false);
      const res = await as(person.get("gm")!.uid, `/5EL/approvals/${id}/approved`, "POST", {});
      expect(res.status).toBe(409);
    } finally {
      await sql("delete from approvals where reason like $1", [`${TAG} vegetables`]);
      await sql("delete from approval_rules where hotel_id = $1 and kind = 'purchase'", [hotelId]);
    }
  });
});
