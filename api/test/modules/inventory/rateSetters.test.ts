import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { RATE_SETTER_ROLES as SERVER_LIST } from "../../../src/modules/inventory/rateSetters.ts";
import {
  RATE_SETTER_ROLES as WEBSITE_LIST, ASSIGNABLE_ROLES,
} from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SET A PRICE ON THE RATE CALENDAR — INV-5

   The owner's decision of 16 September: only the roles in
   RATE_SETTER_ROLES. Before it, PUT /:code/rate-grid asked no role at
   all, so a receptionist who typed the address could price a run of
   dates. The screen now hides and refuses the page; this file proves the
   server refuses the write, for EVERY role a person can be given, and
   that a refusal leaves nothing behind.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the owner can
   set a price would pass with no guard at all.

   Every write is dated 2029 and removed afterwards.
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

const FROM = "2029-03-01";
const TO = "2029-03-03";
const TAG = "INV5TEST";

let ownerId: string;
let roomTypeId: string;
let mealPlan: string;
const staffByRole = new Map<string, string>();
let gmElsewhereId: string;

const setPrice = (staffId: string, price: number) =>
  app.request("/api/hotels/5EL/rate-grid", {
    method: "PUT",
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    body: JSON.stringify({ roomTypeId, mealPlan, from: FROM, to: TO, price, label: TAG }),
  });

const written = async () => Number((await sql(
  `select count(*)::int as n from rates
    where label = $1 and hotel_id = (select id from hotels where code = '5EL')`,
  [TAG])).rows[0].n);

const clearWrites = () => sql("delete from rates where label = $1", [TAG]);

/* A person with ONE role, at 5 Elements — or, for the last case, a GM at
   another property who is only reception here. */
const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const email = `inv5-${key}@fidato.in`;
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [email, `INV5TEST ${key}`, `test-uid-inv5-${key}`]);
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
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;

  const { rows } = await sql(
    `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`);
  roomTypeId = rows[0].id;
  mealPlan = (await sql("select code from meal_plans order by code limit 1")).rows[0].code;

  for (const role of ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: "5EL", role }]));
  }
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: "5EL", role: "front_desk" },
  ]);
});

afterAll(async () => {
  await clearWrites();
  const ids = [...staffByRole.values(), gmElsewhereId];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the server's list of who may set a price", () => {
  it("is the website's list, exactly", () => {
    /* Two copies of one rule, held together here. When the revenue manager
       joins RATE_SETTER_ROLES in src/lib/permissions.ts, this fails until
       api/src/modules/inventory/rateSetters.ts says the same. */
    expect([...SERVER_LIST].sort()).toEqual([...WEBSITE_LIST].sort());
  });
});

describe("setting a price on the Rate calendar (INV-5)", () => {
  it("lets a group administrator set one", async () => {
    await clearWrites();
    const res = await setPrice(ownerId, 3100);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await written()).toBeGreaterThan(0);
  });

  for (const role of ["owner", "admin", "gm", "hotel_manager", "revenue_manager",
                      "front_desk", "housekeeping", "kitchen_manager", "chef", "pos",
                      "stores", "finance", "read_only"]) {
    const may = (WEBSITE_LIST as readonly string[]).includes(role);

    it(`${may ? "lets" : "refuses"} ${role} ${may ? "set" : "setting"} a price`, async () => {
      await clearWrites();
      const res = await setPrice(staffByRole.get(role)!, 3200);

      if (may) {
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await written()).toBeGreaterThan(0);
      } else {
        expect(res.status, await res.clone().text()).toBe(403);
        const body = (await res.json()) as { ok: boolean; reason: string };
        expect(body.ok).toBe(false);
        /* Rule 6: who CAN, so the person knows whom to ask. */
        expect(body.reason).toMatch(/general manager/i);
        expect(await written(), `${role} was refused and a price was written anyway`)
          .toBe(0);
      }
    });
  }

  it("asks the role AT THIS HOTEL - a GM elsewhere is reception here", async () => {
    await clearWrites();
    const res = await setPrice(gmElsewhereId, 3300);
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await written()).toBe(0);
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
