import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  VIEW_ROLES, SETTING_KEEPERS,
} from "../../../src/modules/purchasing/purchasingGrants.ts";
import { grantsFor, ASSIGNABLE_ROLES } from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SEE AND CHANGE PURCHASING — every role, every door

   Three questions with three different answers, and this file keeps them
   apart:

     LOOK      the matrix, `grantsFor(role, "purchasing")`
     RAISE     the per-property SETTING of D18-2, not a list in the code
     CHANGE THE SETTING   the owner or an administrator

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the GM can raise
   a request would pass with no guard at all. Every role a person can be
   given is tried at every door, and after a refusal nothing is left
   behind.

   The first test is the one that stops a slow drift: the server does not
   import the website's code, so VIEW_ROLES is a COPY of the matrix and
   this holds the two to each other.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "PUGTEST";

let storeId: string;
let itemId: string;
const staffByRole = new Map<string, string>();

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true
     returning id::text`,
    [`pug-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-pug-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  return id;
};

const requestCount = async () => Number((await sql(
  "select count(*)::int as n from purchase_requests where reason like $1", [`${TAG}%`],
)).rows[0].n);

beforeAll(async () => {
  const { rows: stores } = await sql(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.kind = 'store' and l.name = 'Main store'`, [HOTEL]);
  storeId = stores[0].id as string;

  const { rows: items } = await sql(
    `insert into stock_items (hotel_id, name, unit)
     select id, $2, 'kg' from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true
     returning id::text`, [HOTEL, `${TAG} rice`]);
  itemId = items[0].id as string;

  for (const role of ASSIGNABLE_ROLES) staffByRole.set(role, await person(role));
});

afterAll(async () => {
  /* Undone the way the system undoes things, and MEASURED (MEMORY 292).
     A purchase request cannot be deleted by the application, so the
     scratch database's superuser does it here — this is a fixture, not a
     ledger, and the scratch database is dropped after the run anyway. */
  await sql(
    "delete from purchase_request_lines where request_id in (select id from purchase_requests where reason like $1)",
    [`${TAG}%`]);
  /* THE ORDER MATTERS: a request POINTS AT its approval, so the request goes
     first. The other way round the foreign key refuses, the teardown dies,
     and one red assertion reads as a broken suite (MEMORY 289).
     The ids are read out into here rather than into a temp table: every call
     of `sql` opens its own pool and closes it, so a temp table would not
     survive to the next line. */
  const { rows: gone } = await sql(
    "select approval_id::text as id from purchase_requests where reason like $1 and approval_id is not null",
    [`${TAG}%`]);
  await sql("delete from purchase_requests where reason like $1", [`${TAG}%`]);
  for (const row of gone) {
    await sql("delete from approvals where id = $1", [row.id as string]);
  }
  await sql("delete from stock_items where name like $1", [`${TAG}%`]);
  for (const id of staffByRole.values()) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("who may see and change purchasing", () => {
  it("VIEW_ROLES is the website's matrix, exactly", () => {
    /* The server cannot import the website's code, so this list is a copy.
       A role given the grant in one place and not the other fails here
       rather than failing a person. */
    const fromMatrix = ASSIGNABLE_ROLES
      .filter((r) => grantsFor(r, "purchasing").includes("view"))
      .sort();
    expect([...VIEW_ROLES].sort()).toEqual(fromMatrix);
  });

  it("only the owner and an administrator may change who may ask", () => {
    expect([...SETTING_KEEPERS].sort()).toEqual(["admin", "owner"]);
  });

  it("refuses the screen to every role the matrix does not grant it", async () => {
    for (const role of ASSIGNABLE_ROLES) {
      const res = await call(staffByRole.get(role)!, "/purchasing");
      const mayLook = grantsFor(role, "purchasing").includes("view");
      expect([role, res.status]).toEqual([role, mayLook ? 200 : 403]);
      if (!mayLook) {
        /* Rule 6: the refusal says who CAN, so the person knows whom to ask. */
        const body = await res.json() as { reason?: string };
        expect(body.reason, role).toContain("general manager");
      }
    }
  });

  it("lets only the roles ON THE SETTING raise one - and leaves nothing behind when it refuses", async () => {
    /* The property's default, from migration 115: the Inventory Manager,
       the GM, the owner and an administrator. Everybody else is refused
       even where the matrix grants them `create` — the hotel manager and
       the kitchen manager hold it and are still refused, which is the
       whole point of D18-2. */
    const onTheSetting = new Set(["stores", "gm", "owner", "admin"]);

    for (const role of ASSIGNABLE_ROLES) {
      const before = await requestCount();
      const res = await call(staffByRole.get(role)!, "/purchasing/requests", "POST", {
        storeId, reason: `${TAG} ${role} tried`,
        lines: [{ itemId, quantity: 1 }],
      });
      const after = await requestCount();

      if (onTheSetting.has(role)) {
        expect([role, res.status]).toEqual([role, 200]);
        expect(after, role).toBe(before + 1);
      } else {
        expect([role, res.status]).toEqual([role, 403]);
        /* NOTHING WAS WRITTEN. A refusal returned inside `withSession` is a
           COMMIT (MEMORY 243), so this is the assertion that matters. */
        expect(after, `${role} left a request behind`).toBe(before);
        const body = await res.json() as { reason?: string };
        expect(body.reason, role).toContain("setting");
      }
    }
  });

  it("switches a kitchen manager on, and off again, with no deploy", async () => {
    const owner = staffByRole.get("owner")!;
    const cook = staffByRole.get("kitchen_manager")!;

    const refused = await call(cook, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} cook before`, lines: [{ itemId, quantity: 1 }],
    });
    expect(refused.status).toBe(403);

    const on = await call(owner, "/purchasing/requesters/kitchen_manager", "PUT",
      { mayRaise: true });
    expect(on.status).toBe(200);

    const allowed = await call(cook, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} cook after`, lines: [{ itemId, quantity: 1 }],
    });
    expect(allowed.status).toBe(200);

    const off = await call(owner, "/purchasing/requesters/kitchen_manager", "PUT",
      { mayRaise: false });
    expect(off.status).toBe(200);

    const refusedAgain = await call(cook, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} cook off again`, lines: [{ itemId, quantity: 1 }],
    });
    expect(refusedAgain.status).toBe(403);
  });

  it("refuses everybody but the owner and an administrator the setting itself", async () => {
    for (const role of ASSIGNABLE_ROLES) {
      const res = await call(staffByRole.get(role)!, "/purchasing/requesters/housekeeping",
        "PUT", { mayRaise: true });
      const may = SETTING_KEEPERS.includes(role);
      expect([role, res.status]).toEqual([role, may ? 200 : 403]);
      if (may) {
        /* Put it back — the next role must meet the same starting point. */
        await call(staffByRole.get(role)!, "/purchasing/requesters/housekeeping",
          "PUT", { mayRaise: false });
      }
    }
    /* And measured: the setting is where it started. */
    const { rows } = await sql(
      `select pr.is_active from purchase_requesters pr
         join hotels h on h.id = pr.hotel_id
        where h.code = $1 and pr.role = 'housekeeping'`, [HOTEL]);
    expect(rows[0]?.is_active ?? false).toBe(false);
  });

  it("refuses a role no person can be given", async () => {
    const res = await call(staffByRole.get("owner")!,
      "/purchasing/requesters/automation", "PUT", { mayRaise: true });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toContain("not a role a person can be given");
  });
});
