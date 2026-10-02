import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import {
  WRITE_RULES, READ_RULES, WITHHELD, isDoor, allows, whoMay, refusalFor, roleGate, UNMAPPED, type Rule,
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
      /* DigiLocker, a fourth way in - off until set up (D27-235 2.5). */
      "POST /api/guest/:token/digilocker",
      "POST /api/guest/:token/google",
      "POST /api/guest/:token/id-photo",
      /* In-room dining (D27-224): behind the code, each its own definer. */
      "POST /api/guest/:token/orders",
      "POST /api/guest/:token/orders/:id/cancel",
      "POST /api/guest/:token/requests",
      "POST /api/guest/:token/tables",              // a table at the restaurant (D27-224)
      "POST /api/guest/:token/tables/:id/cancel",
      "POST /api/guest/:token/verify",
      "POST /api/guest/:token/wake-up",             // a wake-up call, asked by the guest (D27-241)
      /* The room and the phone, no link (D27-235 2.4), and back from DigiLocker. */
      "POST /api/guest/by-room/open",
      "POST /api/guest/by-room/send",
      "POST /api/guest/digilocker/finish",
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

/* ── 1b · Every read has a rule (RO-1, A7, the owner's D27-116) ──────
   Until 28 September the server asked the role on reads only for Form III
   and online check-in: the chef read the Manager report, every stay and
   every bill by address. Now every read the server mounts has a rule, and
   a read with no rule is refused for everybody, as a write is. */

describe("every read the server mounts", () => {
  const mounted = [...new Set(
    app.routes.filter((r) => r.method === "GET").map((r) => `${r.method} ${r.path}`),
  )];

  it("has a rule, or is a door with no person behind it", () => {
    const missing = mounted.filter((k) => !isDoor(k.split(" ")[1]!)
      && k !== "GET /health" && !(k in READ_RULES));
    expect(missing, "a read route with no rule in api/src/roleGate.ts").toEqual([]);
  });

  it("and no rule names a route that is not mounted", () => {
    const stale = Object.keys(READ_RULES).filter((k) => !mounted.includes(k));
    expect(stale).toEqual([]);
  });

  it("asks a role only where it can find the hotel in the address", () => {
    const outside = Object.entries(READ_RULES)
      .filter(([, r]) => r.kind === "grant")
      .map(([k]) => k)
      .filter((k) => !k.split(" ")[1]!.startsWith(`${H}/`));
    expect(outside).toEqual([]);
  });

  it("says who may, in a sentence a person reads", () => {
    for (const [key, r] of Object.entries(READ_RULES)) {
      if (r.kind !== "grant") continue;
      expect(refusalFor(r), key).toMatch(/^[A-Z][^—]* is for [^—]+\. Ask one of them\.$/);
    }
  });

  it("is refused for everybody when nobody mapped it, before any database", async () => {
    const t = new Hono();
    t.use("/api/*", roleGate);
    t.get(`${H}/brand-new`, (c) => c.json({ ok: true }));
    const res = await t.request("/api/hotels/5EL/brand-new");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe(UNMAPPED);
  });
});

/* ── 1c · The owner's answers of 28 September, in the rules ─────────── */

describe("who reads what (D27-140 to D27-147)", () => {
  const readRule = (key: string): Rule => {
    const r = READ_RULES[key];
    if (!r) throw new Error(`no read rule for ${key}`);
    return r;
  };
  const who = (key: string) => whoMay(readRule(key));
  const BILL_READERS = ["owner", "admin", "gm", "hotel_manager", "front_desk", "finance", "read_only"];

  it("D27-143: bills, payments and the cash drawer are not for the roles that only read bookings", () => {
    for (const key of [
      `GET ${H}/folios`, `GET ${H}/stays/:id/bill`, `GET ${H}/stays/:id/folio`,
      `GET ${H}/stays/:id/folios`, `GET ${H}/stays/:id/postings`, `GET ${H}/billable`,
      `GET ${H}/invoices`, `GET ${H}/payments`, `GET ${H}/cashier-shift`,
    ]) {
      expect(who(key), key).toEqual(BILL_READERS);
    }
  });

  it("D27-145, D27-147: money owed and taken is not the revenue manager's; the Manager report is", () => {
    for (const key of [
      `GET ${H}/reports/city-ledger`, `GET ${H}/reports/guest-ledger`,
      `GET ${H}/reports/cashier-shift`, `GET ${H}/reports/balances-by-source`,
    ]) {
      expect(who(key), key).toEqual(BILL_READERS);
    }
    expect(who(`GET ${H}/reports/manager`)).toContain("revenue_manager");
  });

  it("D27-141: no report for housekeeping, the kitchen or the Inventory Manager, nor the chef or the till", () => {
    const readers = who(`GET ${H}/reports/manager`);
    for (const role of ["housekeeping", "kitchen_manager", "stores", "chef", "pos"]) {
      expect(readers, role).not.toContain(role);
    }
  });

  it("D27-195: the rate before GST inside an inclusive rate is anyone's, as the GST rate is", () => {
    expect(READ_RULES[`GET ${H}/tax/room/before-gst`]?.kind).toBe("anyone");
  });

  it("D27-187: View voucher is for exactly the people who may send it", () => {
    expect(who(`GET ${H}/stays/:id/voucher.pdf`))
      .toEqual(whoMay(rule(`POST ${H}/stays/:id/confirmation`)));
  });

  it("D27-142: no bookings for the chef or the Inventory Manager", () => {
    expect(who(`GET ${H}/stays`)).not.toContain("chef");
    expect(who(`GET ${H}/stays`)).not.toContain("stores");
    expect(who(`GET ${H}/stays`)).toContain("housekeeping");
  });

  it("D27-143: a function's bill is withheld from the roles that read bookings only (round E's BQ-1)", () => {
    expect(WITHHELD[`GET ${H}/banquet/events/:id`]).toEqual(
      { keys: ["folioId", "bill", "invoice"], unless: "invoice" });
  });

  it("round E's function money writes keep their rules: the owner, an administrator and the GM; the invoice adds the accountant", () => {
    for (const key of [`POST ${H}/banquet/events/:id/bill`, `POST ${H}/banquet/events/:id/payments`,
      /* D27-154 */ `POST ${H}/banquet/events/:id/reopen`]) {
      expect(whoMay(rule(key)), key).toEqual(["owner", "admin", "gm"]);
    }
    expect(whoMay(rule(`POST ${H}/banquet/events/:id/invoice`)))
      .toEqual(["owner", "admin", "gm", "finance"]);
  });

  it("D27-190: the restaurant's day is opened by whoever closes it", () => {
    expect(whoMay(rule(`POST ${H}/till/day-end/open`)))
      .toEqual(whoMay(rule(`POST ${H}/till/day-end/close`)));
  });

  it("QA AD-1: what the server has set up is the owner's and an administrator's", () => {
    expect(who(`GET ${H}/integrations`)).toEqual(["owner", "admin"]);
  });

  it("D27-146: the Viewer keeps reading what its row allows, and still no ID details", () => {
    expect(who(`GET ${H}/folios`)).toContain("read_only");
    expect(who(`GET ${H}/guests`)).toContain("read_only");
    expect(who(`GET ${H}/form-c`)).not.toContain("read_only");
  });

  it("D27-184: contracts are read by whoever reads companies, kept by the owner, an administrator and the GM; reception adds a company", () => {
    for (const key of [`GET ${H}/company-records`, `GET ${H}/companies/:id/contracts`]) {
      expect(who(key), key).toEqual(BILL_READERS);
    }
    expect(who(`GET ${H}/contract-price`)).toEqual(who(`GET ${H}/tariff`));
    for (const key of [`PATCH ${H}/companies/:id`, `POST ${H}/contracts`, `PUT ${H}/contracts/:id`]) {
      expect(whoMay(rule(key)), key).toEqual(["owner", "admin", "gm"]);
    }
    expect(whoMay(rule(`POST ${H}/companies`))).toEqual(["owner", "admin", "gm", "front_desk"]);
  });
});

describe("the hotel's photos (D27-243)", () => {
  const who = (key: string) => whoMay(READ_RULES[key]!);
  it("are changed by the logo's three and read by everybody there - they are public on the guest's page", () => {
    for (const key of [`POST ${H}/gallery`, `PATCH ${H}/gallery/:id`, `PUT ${H}/gallery/order`, `DELETE ${H}/gallery/:id`]) {
      expect(whoMay(rule(key)), key).toEqual(whoMay(rule(`PUT ${H}/logo`)));
    }
    expect(who(`GET ${H}/gallery/:id`)).toEqual(who(`GET ${H}/gallery`));
    expect(who(`GET ${H}/gallery`)).toEqual(who(`GET ${H}/group`));
  });
});

describe("key cards (D27-178, D27-182)", () => {
  it("are cut by whoever may check a guest in, a lost card too, and read by whoever reads stays", () => {
    const cut = whoMay(rule(`POST ${H}/stays/:id/keys`));
    expect(cut).toEqual(whoMay(rule(`POST ${H}/stays/:id/check-in`)));
    expect(cut).toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk"]);
    expect(READ_RULES[`GET ${H}/stays/:id/keys`]).toBe(READ_RULES[`GET ${H}/stays/:id`]);
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
      `PUT ${H}/pricing/addon`,
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
    /* Taken is the waiter's (D27-222), not the kitchen's. */
    expect(allows(rule(`POST ${H}/till/orders/:id/taken`), "pos")).toBe(true);
    expect(allows(rule(`POST ${H}/till/orders/:id/taken`), "chef")).toBe(false);
    /* In-room dining (D27-224): whoever rings the till accepts and declines. */
    expect(allows(rule(`POST ${H}/till/guest-orders/:id/decline`), "pos")).toBe(true);
    expect(allows(rule(`POST ${H}/till/guest-orders/:id/decline`), "housekeeping")).toBe(false);
    expect(allows(rule(`POST ${H}/till/menu/items`), "kitchen_manager")).toBe(true);
    expect(allows(rule(`PUT ${H}/till/menu/items/:id/variations`), "kitchen_manager")).toBe(true);
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

  it("D22-44: a VAT bill is cancelled by the four who issue a credit note", () => {
    expect(who(`POST ${H}/vat-bills/:number{.+}/cancel`))
      .toEqual(["owner", "admin", "gm", "finance"]);
  });

  it("D22-36: the night audit stays as it is", () => {
    expect(who(`POST ${H}/night-audit/run`))
      .toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk", "finance"]);
  });

  it("D22-35: the menu - dishes, add-ons, promotions, a dish off - is not the revenue manager's", () => {
    const menu = Object.keys(WRITE_RULES).filter((k) => /\/till\/(menu|promotions|addons)\//.test(k)
      || k.endsWith("/till/promotions"));
    /* 23 since D27-192 made the three variation routes one PUT. */
    expect(menu.length).toBeGreaterThanOrEqual(23);
    for (const key of menu) {
      expect(who(key), key).toEqual(["owner", "admin", "gm", "kitchen_manager"]);
    }
  });

  it("D22-34: a repair's writes are the route's, which alone can see whether it names equipment", () => {
    expect(rule(`POST ${H}/work-orders`).kind).toBe("own");
    expect(rule(`PATCH ${H}/work-orders/:id`).kind).toBe("own");
  });

  it("D27-181: a guest request's read and writes are the route's, which alone knows the request's team", () => {
    expect(rule(`POST ${H}/requests`).kind).toBe("own");
    expect(rule(`PATCH ${H}/requests/:id`).kind).toBe("own");
    expect(READ_RULES[`GET ${H}/requests`]?.kind).toBe("own");
  });

  it("D27-241: wake-up calls and lost property are the route's, which knows the desk from housekeeping", () => {
    for (const key of [`POST ${H}/wake-up-calls`, `PATCH ${H}/wake-up-calls/:id`,
                       `POST ${H}/lost-property`, `PATCH ${H}/lost-property/:id`]) {
      expect(rule(key).kind, key).toBe("own");
    }
    expect(READ_RULES[`GET ${H}/wake-up-calls`]?.kind).toBe("own");
    expect(READ_RULES[`GET ${H}/lost-property`]?.kind).toBe("own");
  });

  it("D27-224: the desk's reply to a guest is the route's own, for the desk's roles", () => {
    const r = rule(`POST ${H}/online-checkin/messages/:reservationId/reply`);
    expect(r.kind).toBe("own");
    expect(JSON.stringify(r)).toContain("DESK_ROLES");
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
  ["PUT", "/pricing/addon", {}],
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

  it("D22-44: reception and the hotel manager are refused a VAT bill's cancellation; the accountant and GM are not", async () => {
    const key = `POST ${H}/vat-bills/:number{.+}/cancel`;
    for (const role of ["front_desk", "hotel_manager"]) {
      await refusedByGate(await send(as(role), "POST", "/vat-bills/NO-SUCH/cancel", {}), key);
    }
    for (const role of ["finance", "gm"]) {
      const res = await send(as(role), "POST", "/vat-bills/NO-SUCH/cancel", {});
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

/* ── D25-38: guests' ID and Form C details, read by the check-in roles only ── */

/* ── GU-1 (round D): correcting a guest, read and write ── */

describe("Edit guest (GU-1)", () => {
  it("is read and changed by exactly the roles holding customer:edit", () => {
    const EDITORS = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
    expect(whoMay(READ_RULES[`GET ${H}/guests/:id/record`]!)).toEqual(EDITORS);
    expect(whoMay(WRITE_RULES[`PATCH ${H}/guests/:id`]!)).toEqual(EDITORS);
  });
});

describe("the reads that hand out a guest's passport or ID number (D25-38)", () => {
  const CHECK_IN_ROLES = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
  const READS: [string, string][] = [
    ["/form-c", `GET ${H}/form-c`],
    ["/reports/c-form?from=2026-01-01&to=2026-12-31", `GET ${H}/reports/c-form`],
  ];
  const readRule = (key: string): Rule => {
    const r = READ_RULES[key];
    if (!r) throw new Error(`no read rule for ${key}`);
    return r;
  };

  it("are every mounted read that returns an ID field, and each is mounted", () => {
    /* The reads that select guest_documents' or a submission's numbers
       (grep id_number, passport, visa in api/src). A new one goes here. */
    /* Every read has a rule since 28 September, so these are picked out by
       the rule they carry: the ID grant, or the desk's own list. */
    const idReads = Object.entries(READ_RULES)
      .filter(([, r]) => (r.kind === "grant" && /passport/.test(r.doing))
        || (r.kind === "own" && /DESK_ROLES/.test(r.where)))
      .map(([k]) => k).sort();
    expect(idReads).toEqual([
      `GET ${H}/form-c`, `GET ${H}/online-checkin`,
      `GET ${H}/online-checkin/id-photos`, `GET ${H}/online-checkin/id-photos/:id`,
      `GET ${H}/online-checkin/messages`,
      `GET ${H}/reports/c-form`,
    ]);
  });

  it("let in exactly the owner, an administrator, the GM, the hotel manager and reception", () => {
    for (const [, key] of READS) expect(whoMay(readRule(key)), key).toEqual(CHECK_IN_ROLES);
    expect(refusalFor(readRule(`GET ${H}/form-c`))).toBe(
      "Reading guests' passport and ID details is for the owner, an administrator, "
      + "the general manager, the hotel manager or reception. Ask one of them.");
  });

  it("refuse housekeeping, the kitchen, a till operator and the accountant, in the gate's words", async () => {
    for (const role of ["housekeeping", "kitchen_manager", "chef", "pos", "finance", "read_only"]) {
      for (const [path, key] of READS) {
        const res = await send(as(role), "GET", path);
        expect(res.status, `${role} ${path}: ${await res.clone().text()}`).toBe(403);
        expect(((await res.json()) as { reason: string }).reason, `${role} ${path}`)
          .toBe(refusalFor(readRule(key)));
      }
    }
  });

  it("answer reception, the hotel manager and the group administrator", async () => {
    for (const id of [as("front_desk"), as("hotel_manager"), ownerId]) {
      for (const [path] of READS) {
        const res = await send(id, "GET", path);
        expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
        expect(((await res.json()) as { rows: unknown[] }).rows).toBeInstanceOf(Array);
      }
    }
  });

  it("the guests' own online details stay reception's (their route's own check)", async () => {
    const res = await send(as("housekeeping"), "GET", "/online-checkin");
    expect(res.status).toBe(403);
    expect((await send(as("front_desk"), "GET", "/online-checkin")).status).toBe(200);
  });
});

describe("somebody not rostered at the hotel", () => {
  it("passes to the route, which says what it always said", async () => {
    const res = await send(puneClerkId, "PUT", "/pricing/base", { from: "2029-01-01", price: 1 });
    expect(res.status, await res.clone().text()).toBe(404);
  });
});

/* ── Reads, asked of every role through the real server (RO-1) ──────
   The QA's RO rows, plus the owner's answers: every role, and for each read
   either the gate's own refusal or no refusal from the gate at all. A 400
   for a missing parameter is the route's answer, which means the gate let
   the person through. */

describe("the reads, as every role (RO-1, D27-140 to D27-147)", () => {
  const PROBES = [
    "/reports/manager", "/stays", "/folios", "/billable", "/payments", "/cashier-shift",
    "/reports/balances-by-source", "/reports/city-ledger", "/companies", "/guests",
    "/invoices", `/stays/${UUID}/bill`, "/reports/guest-ledger?from=2026-08-01&to=2026-08-31",
    "/reports/cashier-shift?from=2026-08-01&to=2026-08-31", "/statistics/period", "/pricing",
    "/till/orders", "/kitchen", "/notifications", "/rooms", "/modules", "",
  ];
  const keyFor = (path: string) => {
    const bare = path.split("?")[0]!.replace(UUID, ":id");
    return `GET ${H}${bare}`;
  };

  /* The pre-launch review (1 October): Hono answers HEAD with the GET route,
     but c.req.method is "HEAD", so the gate let it through and a refused person
     could learn from the status whether a read would succeed. */
  it("treats HEAD as GET: a read the gate refuses is refused on HEAD too", async () => {
    const key = keyFor("/reports/manager");
    const r = READ_RULES[key]!;
    const refused = websiteMatrix.ASSIGNABLE_ROLES.find(
      (role) => r.kind === "grant" && !allows(r, role as Parameters<typeof allows>[1]));
    expect(refused, "some role is refused the manager report").toBeTruthy();
    expect((await send(as(refused!), "GET", "/reports/manager")).status).toBe(403);
    expect((await send(as(refused!), "HEAD", "/reports/manager")).status).toBe(403);
  });

  it("refuses exactly the roles the rule leaves out, in the gate's words", async () => {
    const wrong: string[] = [];
    for (const role of websiteMatrix.ASSIGNABLE_ROLES) {
      for (const path of PROBES) {
        const key = keyFor(path);
        const r = READ_RULES[key];
        if (!r) throw new Error(`no read rule for ${key}`);
        const res = await send(as(role), "GET", path);
        const body = res.status === 403 ? await res.json() as { reason?: string } : null;
        const refused = res.status === 403 && body?.reason === refusalFor(r);
        if (refused === allows(r, role)) wrong.push(`${role} ${path}: ${res.status}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("the chef reads neither the Manager report, a stay nor a bill (RO-1)", async () => {
    for (const path of ["/reports/manager", "/stays", "/folios"]) {
      expect((await send(as("chef"), "GET", path)).status, path).toBe(403);
    }
  });

  it("the revenue manager reads no guest messages (RO-3, D27-144), in the route's words", async () => {
    const res = await send(as("revenue_manager"), "GET", "/guest-messages");
    expect(res.status).toBe(403);
    expect((await send(as("front_desk"), "GET", "/guest-messages")).status).toBe(200);
  });

  it("leads are for whoever sees guests, marketing's numbers for the owner, an administrator and the GM (D27-170)", async () => {
    const GUEST_READERS = ["owner", "admin", "gm", "hotel_manager", "front_desk", "finance", "read_only"];
    for (const key of [`GET ${H}/leads`, `GET ${H}/leads/:ref`, `GET ${H}/leads/:ref/booking`]) {
      expect(whoMay(READ_RULES[key]!), key).toEqual(GUEST_READERS);
    }
    expect(whoMay(READ_RULES[`GET ${H}/marketing/numbers`]!)).toEqual(["owner", "admin", "gm"]);
    expect((await send(as("housekeeping"), "GET", "/leads")).status).toBe(403);
    expect((await send(as("front_desk"), "GET", "/leads")).status).toBe(200);
    expect((await send(as("front_desk"), "GET", "/marketing/numbers?month=2026-09")).status).toBe(403);
  });

  it("loyalty: the desk joins and takes points off a bill, whoever sees guests opens the screen (D27-179)", async () => {
    expect(whoMay(WRITE_RULES[`POST ${H}/loyalty/guests/:id/join`]!))
      .toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk"]);
    expect(whoMay(WRITE_RULES[`POST ${H}/loyalty/stays/:id/redeem`]!))
      .toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk", "finance"]);
    const join = await send(as("housekeeping"), "POST", "/loyalty/guests/00000000-0000-0000-0000-000000000000/join", { agreed: true });
    expect(join.status).toBe(403);
    expect((await send(as("housekeeping"), "GET", "/loyalty")).status).toBe(403);
    expect((await send(as("front_desk"), "GET", "/loyalty")).status).toBe(200);
  });

  it("the accountant opens the Accounting export (D27-122), and still not Form III", async () => {
    const book = await send(as("finance"), "GET", "/accounting/day-book?from=2026-08-01&to=2026-08-31");
    expect(book.status, await book.clone().text()).toBe(200);
    expect((await send(as("finance"), "GET", "/form-c")).status).toBe(403);
  });

  it("the revenue manager downloads the Manager report but not the City ledger (D27-147)", async () => {
    const manager = await send(as("revenue_manager"), "GET", "/reports/manager.csv");
    expect(manager.status, await manager.clone().text()).toBe(200);
    const ledger = await send(as("revenue_manager"), "GET", "/reports/city-ledger.csv");
    expect(ledger.status).toBe(403);
    expect((await send(as("finance"), "GET", "/reports/city-ledger.csv")).status).toBe(200);
  });
});

describe("what a read withholds (D27-143)", () => {
  type Row = Record<string, unknown>;
  const rows = async (role: string, path: string) =>
    (await (await send(as(role), "GET", path)).json()) as Row[];

  it("blanks a guest's phone and email for housekeeping, and keeps them for reception", async () => {
    /* The demo's guests carry no phone, so one is given one for the test
       and handed back as it was. */
    const picked = (await sql(
      `select r.id::text as stay, g.id::text as guest, g.phone from reservations r
         join guests g on g.id = r.guest_id join hotels h on h.id = r.hotel_id
        where h.code = '5EL' order by r.check_in desc limit 1`)).rows[0] as
      { stay: string; guest: string; phone: string | null };
    const withPhone = picked.stay;
    await sql("update guests set phone = $2 where id = $1", [picked.guest, "9000012345"]);
    try {

    const desk = (await rows("front_desk", "/stays")).find((s) => s["id"] === withPhone)!;
    expect(desk["phone"]).toBe("9000012345");
    for (const role of ["housekeeping", "revenue_manager", "kitchen_manager", "pos"]) {
      const theirs = (await rows(role, "/stays")).find((s) => s["id"] === withPhone)!;
      expect(theirs, role).toBeTruthy();
      expect([theirs["phone"], theirs["email"]], role).toEqual([null, null]);
      expect(theirs["guest"], role).toBe(desk["guest"]);
      const one = (await (await send(as(role), "GET", `/stays/${withPhone}`)).json()) as Row;
      expect([one["phone"], one["email"]], `${role} one stay`).toEqual([null, null]);
    }
    } finally {
      await sql("update guests set phone = $2 where id = $1", [picked.guest, picked.phone]);
    }
  });

  it("sends a group's balances to reception and not to housekeeping", async () => {
    /* scope=all: the demo's group is in the past. Asserted non-empty, or
       the loop below would pass with nothing in it (MEMORY fault 4). */
    const desk = await rows("front_desk", "/groups?scope=all");
    const hk = await rows("housekeeping", "/groups?scope=all");
    expect(desk.length, "the demo has a group").toBeGreaterThan(0);
    expect(hk.length).toBe(desk.length);
    expect(typeof desk[0]!["guestBalance"]).toBe("number");
    for (const g of hk) expect([g["masterBalance"], g["guestBalance"]]).toEqual([null, null]);

    const id = String(desk[0]!["id"]);
    const deskOne = (await (await send(as("front_desk"), "GET", `/groups/${id}`)).json()) as Row;
    const hkOne = (await (await send(as("housekeeping"), "GET", `/groups/${id}`)).json()) as Row;
    expect(typeof deskOne["guestBalance"]).toBe("number");
    expect([hkOne["guestBalance"], hkOne["master"]]).toEqual([null, null]);
    const rooms = hkOne["rooms"] as Row[];
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.map((r) => r["balance"])).toEqual(rooms.map(() => null));
    expect(rooms.map((r) => r["guest"])).toEqual((deskOne["rooms"] as Row[]).map((r) => r["guest"]));
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

describe("the Store's fourteen days (D27-238, D27-242)", () => {
  it("is the Store's own read: whoever sees the Store; the sales in it are the route's to withhold", () => {
    expect(READ_RULES[`GET ${H}/stores/days`]).toEqual(READ_RULES[`GET ${H}/stores`]);
  });
});

describe("Settings, security (D27-243 phase 5, D27-245)", () => {
  it("leaves the activity log and sign-ins to their routes' own answers, and the password check to the person", () => {
    expect(READ_RULES[`GET ${H}/activity`]).toMatchObject({ kind: "own" });
    expect(READ_RULES[`GET /api/admin/staff/:id/sign-ins`]).toMatchObject({ kind: "own" });
    expect(READ_RULES[`GET /api/me/password`]).toEqual({ kind: "self" });
  });
});
