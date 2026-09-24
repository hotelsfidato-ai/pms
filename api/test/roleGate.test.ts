import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import {
  WRITE_RULES, isDoor, allows, whoMay, refusalFor, roleGate, UNMAPPED, type Rule,
} from "../src/roleGate.ts";
import * as serverMatrix from "../src/permissions.ts";
import * as websiteMatrix from "../../src/lib/permissions.ts";
import { RATE_SETTER_REFUSED } from "../src/modules/inventory/rateSetters.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SERVER ASKS THE ROLE ON EVERY WRITE — PMS-2, the owner's D21-88

   Three things are held here:
     1. every write the server mounts has a rule, or is one of the three
        doors with no person behind it - so a new route cannot skip the check
     2. the matrix the server asks is the website's own, not a copy
     3. the refusals the task named: a Viewer makes no booking and sets no
        price, housekeeping sets no price, and the owner, an administrator
        and the GM pass

   ⚠ THE REFUSALS ARE THE POINT, and each asserts the GATE's sentence, not
   only a 403 - a route with its own check answers 403 too (MEMORY 295).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const WRITES = ["POST", "PUT", "PATCH", "DELETE"];
const H = "/api/hotels/:code";
const rule = (key: string): Rule => {
  const r = WRITE_RULES[key];
  if (!r) throw new Error(`no rule for ${key}`);
  return r;
};

/* ── 1 · Every write has a rule ───────────────────────────────────── */

describe("every write the server mounts", () => {
  const mounted = [...new Set(
    app.routes.filter((r) => WRITES.includes(r.method)).map((r) => `${r.method} ${r.path}`),
  )];

  it("has a rule, or is a door with no person behind it", () => {
    const missing = mounted.filter((k) => !isDoor(k.split(" ")[1]!) && !(k in WRITE_RULES));
    expect(missing, "a write route with no rule in api/src/roleGate.ts").toEqual([]);
  });

  it("and no rule names a route that is not mounted", () => {
    const stale = Object.keys(WRITE_RULES).filter((k) => !mounted.includes(k));
    expect(stale).toEqual([]);
  });

  it("is behind the gate, mounted in front of every router", () => {
    /* A map nobody asks is decoration. The gate is the app's own middleware
       under /api, registered before the first router. */
    const at = app.routes.findIndex(
      (r) => r.method === "ALL" && r.path === "/api/*" && r.handler === roleGate);
    const firstRoute = app.routes.findIndex(
      (r) => r.method !== "ALL" && r.path.startsWith("/api/"));
    expect(at, "roleGate is not mounted in server.ts").toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(firstRoute);
  });

  it("leaves exactly the three person-less doors to themselves", () => {
    const doors = mounted.filter((k) => isDoor(k.split(" ")[1]!)).sort();
    expect(doors).toEqual([
      "POST /api/channel/su/reservations",
      "POST /api/guest/:token/code",
      "POST /api/guest/:token/details",
      "POST /api/guest/:token/requests",
      "POST /api/guest/:token/verify",
      "POST /api/pos/tickets",
      "POST /api/pos/tickets/:ref/void",
    ]);
    /* The channel manager's OWN settings start with the same letters and
       need a person (MEMORY 295). */
    expect(isDoor("/api/channel-manager/su/login")).toBe(false);
    expect(isDoor("/api/guests")).toBe(false);
  });

  it("asks a role only where it can find the hotel in the address", () => {
    const outside = Object.entries(WRITE_RULES)
      .filter(([, r]) => r.kind === "grant")
      .map(([k]) => k)
      .filter((k) => !k.split(" ")[1]!.startsWith(`${H}/`));
    expect(outside).toEqual([]);
  });
});

/* ── 2 · One matrix ───────────────────────────────────────────────── */

describe("the matrix the server asks", () => {
  it("is the website's, the same file and not a copy", () => {
    /* The website re-exports api/src/permissions.ts. If somebody gives the
       website its own matrix again, these stop being the same objects. */
    expect(websiteMatrix.can).toBe(serverMatrix.can);
    expect(websiteMatrix.grantsFor).toBe(serverMatrix.grantsFor);
    expect(websiteMatrix.ROLES).toBe(serverMatrix.ROLES);
    expect(websiteMatrix.RESOURCES).toBe(serverMatrix.RESOURCES);
  });

  it("never lets a viewer write", () => {
    /* read_only: "Read-only across the platform. No write access anywhere." */
    const open = Object.entries(WRITE_RULES)
      .filter(([, r]) => r.kind === "grant")
      .filter(([, r]) => allows(r, "read_only"))
      .map(([k]) => k);
    expect(open).toEqual([]);
  });

  it("gives every price write to exactly the rate setters (INV-5)", () => {
    const prices = [
      `PUT ${H}/pricing/basis`, `PUT ${H}/pricing/base`, `PUT ${H}/pricing/offset`,
      `PUT ${H}/room-types/:id/rate`, `POST ${H}/rate-plans`, `DELETE ${H}/rate-plans/:id`,
      `POST ${H}/restrictions`, `POST ${H}/cancellation-policies`,
      `DELETE ${H}/cancellation-policies/:id`, `PUT ${H}/cancellation-policies/:id/default`,
    ];
    for (const key of prices) {
      expect(whoMay(rule(key)), key).toEqual([...websiteMatrix.RATE_SETTER_ROLES]);
    }
  });

  it("answers the task's cases", () => {
    const booking = rule(`POST ${H}/bookings`);
    expect(whoMay(booking)).toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk"]);
    expect(allows(rule(`PUT ${H}/rooms/:number/housekeeping`), "housekeeping")).toBe(true);
    expect(allows(rule(`PUT ${H}/pricing/base`), "housekeeping")).toBe(false);
    /* The restaurant keeps the roles its menu names (pos/nav.ts). */
    expect(allows(rule(`POST ${H}/till/orders`), "pos")).toBe(true);
    expect(allows(rule(`POST ${H}/kitchen/lines/:lineId/:to`), "chef")).toBe(true);
    expect(allows(rule(`POST ${H}/till/menu/items`), "kitchen_manager")).toBe(true);
    expect(allows(rule(`POST ${H}/till/orders`), "housekeeping")).toBe(false);
  });

  /* ── The owner's answers of 22 September (docs/briefs/decisions-2026-09-22.md) ── */

  const who = (key: string) => whoMay(rule(key));
  const byName = (key: string) => { const r = rule(key); return r.kind === "grant" ? r.also : null; };

  it("D22-30: the GM sets the hotel up - in the matrix, not by name", () => {
    for (const key of [
      `POST ${H}/room-types`, `PATCH ${H}/room-types/:id`, `POST ${H}/rooms`,
      `PATCH ${H}/rooms/:number`, `PATCH ${H}/front-desk`, `POST ${H}/room-types/import`,
      `POST ${H}/rooms/import`, `POST ${H}/banquet/venues`, `PATCH ${H}/banquet/venues/:id`,
      `POST ${H}/banquet/packages`,
    ]) {
      expect(who(key), key).toEqual(["owner", "admin", "gm"]);
      expect(byName(key), key).toEqual([]);
    }
  });

  it("D22-30: an administrator and the GM set a commission - in the matrix", () => {
    const key = `PUT ${H}/booking-sources/:id/commission`;
    expect(who(key)).toEqual(["owner", "admin", "gm"]);
    expect(byName(key)).toEqual([]);
  });

  it("D22-32: GST is the owner's, an administrator's, the GM's and the accountant's", () => {
    for (const key of [`PUT ${H}/tax/:kind`, `PATCH ${H}/menu-categories/:name/tax-kind`]) {
      expect(who(key), key).toEqual(["owner", "admin", "gm", "finance"]);
    }
  });

  it("D22-33: a credit note is no longer reception's or the hotel manager's", () => {
    expect(who(`POST ${H}/invoices/:number{.+}/credit-note`))
      .toEqual(["owner", "admin", "gm", "finance"]);
  });

  it("D22-36: the night audit stays as it is", () => {
    expect(who(`POST ${H}/night-audit/run`))
      .toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk", "finance"]);
  });

  it("D22-35: the menu - dishes, add-ons, promotions, a dish off - is not the revenue manager's", () => {
    const menu = Object.keys(WRITE_RULES).filter((k) => /\/till\/(menu|promotions|addons)\//.test(k)
      || k.endsWith("/till/promotions"));
    expect(menu.length).toBeGreaterThanOrEqual(24);
    for (const key of menu) {
      expect(who(key), key).toEqual(["owner", "admin", "gm", "kitchen_manager"]);
    }
  });

  it("D22-34: a repair's writes are the route's, which alone can see whether it names equipment", () => {
    expect(rule(`POST ${H}/work-orders`).kind).toBe("own");
    expect(rule(`PATCH ${H}/work-orders/:id`).kind).toBe("own");
  });

  it("says who may, in a sentence a person reads", () => {
    for (const [key, r] of Object.entries(WRITE_RULES)) {
      if (r.kind !== "grant") continue;
      const text = refusalFor(r);
      expect(text, key).toMatch(/^[A-Z][^—]* is for [^—]+\. Ask one of them\.$/);
      expect(text, key).not.toMatch(/automation/);
    }
  });
});

/* ── 3 · Asked of real people, through the real server ────────────── */

const UUID = "00000000-0000-4000-8000-000000000000";
const TAG = "PMS2TEST";
const staffByRole = new Map<string, string>();
let ownerId: string;
let gmElsewhereId: string;
let puneClerkId: string;

const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const email = `pms2-${key}@fidato.in`;
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [email, `${TAG} ${key}`, `test-uid-pms2-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const r of roles) {
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = $3`, [id, r.role, r.hotel]);
  }
  return id;
};

const send = (staffId: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A 403 from the GATE, with its own sentence for this route. */
const refusedByGate = async (res: Response, key: string) => {
  expect(res.status, `${key}: ${await res.clone().text()}`).toBe(403);
  const body = (await res.json()) as { ok: boolean; reason: string };
  expect(body.ok).toBe(false);
  expect(body.reason, key).toBe(refusalFor(rule(key)));
};

/* Every price write INV-5 named, with a body each route refuses on its own
   (409) before it writes anything - so a probe that passes the gate changes
   nothing. */
const PRICE_PROBES: [string, string, unknown][] = [
  ["PUT", "/pricing/basis", {}],
  ["PUT", "/pricing/base", {}],
  ["PUT", "/pricing/offset", {}],
  ["PUT", `/room-types/${UUID}/rate`, {}],
  ["POST", "/rate-plans", {}],
  ["DELETE", `/rate-plans/${UUID}`, undefined],
  ["POST", "/restrictions", {}],
  ["POST", "/cancellation-policies", {}],
  ["DELETE", `/cancellation-policies/${UUID}`, undefined],
  ["PUT", `/cancellation-policies/${UUID}/default`, { on: false }],
];
const keyOf = (method: string, path: string) =>
  `${method} ${H}${path.replace(UUID, ":id")}`;

/* A whole Rate calendar price, which that route checks for shape BEFORE it
   asks the role - so an empty body would be refused for the wrong reason. */
let roomTypeId: string;
let mealPlan: string;
const gridPrice = () =>
  ({ roomTypeId, mealPlan, from: "2029-04-01", to: "2029-04-02", price: 4100, label: TAG });
const pricesWritten = async () => Number((await sql(
  "select count(*)::int as n from rates where label = $1", [TAG])).rows[0].n);

beforeAll(async () => {
  roomTypeId = (await sql(
    `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`)).rows[0].id;
  mealPlan = (await sql("select code from meal_plans order by code limit 1")).rows[0].code;
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  puneClerkId = (await sql("select id::text from staff where email = 'pune@fidato.in'")).rows[0].id;
  for (const role of websiteMatrix.ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: "5EL", role }]));
  }
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: "5EL", role: "front_desk" },
  ]);
});

afterAll(async () => {
  await sql("delete from rates where label = $1", [TAG]);
  const ids = [...staffByRole.values(), gmElsewhereId];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

const as = (role: string) => staffByRole.get(role)!;

describe("a viewer", () => {
  it("is refused a booking, and no guest is made", async () => {
    const res = await send(as("read_only"), "POST", "/bookings", {
      guest: { fullName: `${TAG} viewer's guest`, phone: "9999999999" },
    });
    await refusedByGate(res, `POST ${H}/bookings`);
    /* Rule 6: who CAN, so the person knows whom to ask. */
    expect(refusalFor(rule(`POST ${H}/bookings`))).toBe(
      "Making a booking is for the owner, an administrator, the general manager, "
      + "the hotel manager or reception. Ask one of them.");
    const { rows } = await sql("select count(*)::int as n from guests where full_name = $1",
      [`${TAG} viewer's guest`]);
    expect(rows[0].n).toBe(0);
  });

  it("is refused the Rate calendar, in its own words as before (INV-5)", async () => {
    const res = await send(as("read_only"), "PUT", "/rate-grid", gridPrice());
    expect(res.status, await res.clone().text()).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe(RATE_SETTER_REFUSED);
    expect(await pricesWritten()).toBe(0);
  });

  it("is refused a check-in, a charge, a payment and a room's status", async () => {
    for (const [method, path, key] of [
      ["POST", `/stays/${UUID}/check-in`, `POST ${H}/stays/:id/check-in`],
      ["POST", `/stays/${UUID}/charges`, `POST ${H}/stays/:id/charges`],
      ["POST", `/stays/${UUID}/payments`, `POST ${H}/stays/:id/payments`],
      ["PUT", "/rooms/101/housekeeping", `PUT ${H}/rooms/:number/housekeeping`],
    ] as const) {
      await refusedByGate(await send(as("read_only"), method, path, {}), key);
    }
  });

  it("rings nothing up at the till it may look at", async () => {
    await refusedByGate(await send(as("read_only"), "POST", "/till/orders", {}),
      `POST ${H}/till/orders`);
  });
});

describe("housekeeping", () => {
  it("is refused every price write", async () => {
    for (const [method, path, body] of PRICE_PROBES) {
      await refusedByGate(await send(as("housekeeping"), method, path, body), keyOf(method, path));
    }
    const grid = await send(as("housekeeping"), "PUT", "/rate-grid", gridPrice());
    expect(grid.status, await grid.clone().text()).toBe(403);
    expect(await pricesWritten()).toBe(0);
  });

  it("still sets a room's status (the gate lets it through to the route)", async () => {
    const res = await send(as("housekeeping"), "PUT", "/rooms/NO-SUCH-ROOM/housekeeping", {});
    expect(res.status, await res.clone().text()).not.toBe(403);
  });
});

describe("the owner, an administrator and the GM", () => {
  const setters = () => [
    ["the group administrator", ownerId],
    ["owner", as("owner")], ["admin", as("admin")], ["gm", as("gm")],
    ["revenue_manager", as("revenue_manager")],
  ] as const;

  it("pass the gate on every price write, to the route's own answer", async () => {
    for (const [who, id] of setters()) {
      for (const [method, path, body] of PRICE_PROBES) {
        const res = await send(id, method, path, body);
        /* 409: the route refused the empty body itself, so the gate let it in. */
        expect(res.status, `${who} ${method} ${path}: ${await res.clone().text()}`).toBe(409);
      }
    }
  });

  it("but a GM elsewhere who is reception here is asked as reception", async () => {
    await refusedByGate(await send(gmElsewhereId, "PUT", "/pricing/base", {}),
      `PUT ${H}/pricing/base`);
  });
});

describe("the owner's answers of 22 September, through the real server", () => {
  /* Each probe that passes the gate carries a body its route refuses on its
     own (409) before anything is written. */
  it("D22-30: the GM passes the gate on room setup; the hotel manager does not", async () => {
    /* Not the banquet halls here: the scratch database has 5EL's banquet
       module off, and its own gate would answer first. The halls' rule is
       the same grant (the unit test above). */
    for (const [path, key] of [
      ["/room-types", `POST ${H}/room-types`],
      ["/rooms", `POST ${H}/rooms`],
    ] as const) {
      const gm = await send(as("gm"), "POST", path, {});
      expect(gm.status, `gm ${path}: ${await gm.clone().text()}`).toBe(409);
      await refusedByGate(await send(as("hotel_manager"), "POST", path, {}), key);
    }
  });

  it("D22-30: an administrator and the GM pass the gate on a commission", async () => {
    for (const role of ["admin", "gm"]) {
      const res = await send(as(role), "PUT", `/booking-sources/${UUID}/commission`,
        { commissionPct: "not a number" });
      expect(res.status, `${role}: ${await res.clone().text()}`).toBe(409);
    }
    await refusedByGate(
      await send(as("revenue_manager"), "PUT", `/booking-sources/${UUID}/commission`, {}),
      `PUT ${H}/booking-sources/:id/commission`);
  });

  it("D22-33: reception and the hotel manager are refused a credit note; the accountant and GM are not", async () => {
    const key = `POST ${H}/invoices/:number{.+}/credit-note`;
    for (const role of ["front_desk", "hotel_manager"]) {
      await refusedByGate(await send(as(role), "POST", "/invoices/NO-SUCH/credit-note", {}), key);
    }
    for (const role of ["finance", "gm"]) {
      const res = await send(as(role), "POST", "/invoices/NO-SUCH/credit-note", {});
      expect(res.status, `${role}: ${await res.clone().text()}`).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/must say why/);
    }
  });

  it("D22-35: the revenue manager is refused the menu, a dish off and a promotion", async () => {
    for (const [path, key] of [
      ["/till/menu/items", `POST ${H}/till/menu/items`],
      [`/till/menu/items/${UUID}/off`, `POST ${H}/till/menu/items/:id/off`],
      ["/till/promotions", `POST ${H}/till/promotions`],
    ] as const) {
      await refusedByGate(await send(as("revenue_manager"), "POST", path, {}), key);
    }
  });
});

describe("somebody not rostered at the hotel", () => {
  it("passes to the route, which says what it always said", async () => {
    const res = await send(puneClerkId, "PUT", "/pricing/base", { from: "2029-01-01", price: 1 });
    expect(res.status, await res.clone().text()).toBe(404);
  });
});

describe("a write route nobody mapped", () => {
  it("is refused for everybody, before any database", async () => {
    const t = new Hono();
    t.use("/api/*", roleGate);
    t.post(`${H}/brand-new`, (c) => c.json({ ok: true }));
    const res = await t.request("/api/hotels/5EL/brand-new", { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe(UNMAPPED);
  });
});
