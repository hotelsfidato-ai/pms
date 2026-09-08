import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   COURSES, THROUGH THE WIRE

   `db/tests/suite.sql` proves the fallback and the ordering against the
   tables. This proves what the PASS receives, which is a different
   question: the kitchen screen groups by table and then by course, and
   it can only do that if the course reaches it at all.

   ⚠ THE ASSERTION THAT MATTERS IS THE DRINK. An unsequenced dish must
   arrive as `null` — not zero, and not absent. Zero would sort it ahead
   of the starters on every table; absent would print "undefined" on a
   pass screen, which this project has already done once today.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

interface KitchenLine {
  id: string; name: string; course: number | null;
}

let ownerUid: string;
let outlet: string | null = null;
let hotelId: string | null = null;
let catId: string | null = null;
let starter: string | null = null;
let main: string | null = null;
let drink: string | null = null;
let orderId: string | null = null;

const call = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function pass(): Promise<KitchenLine[]> {
  const res = await call("/5EL/kitchen");
  const body = (await res.json()) as { lines: KitchenLine[] };
  return body.lines;
}

beforeAll(async () => {
  const db = await admin();
  try {
    ownerUid = (await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    )).rows[0]!.uid;

    hotelId = (await db.query<{ id: string }>(
      "select id::text from hotels where code = '5EL'",
    )).rows[0]!.id;

    outlet = (await db.query<{ code: string }>(
      `select o.code from pos_outlets o join hotels h on h.id = o.hotel_id
        where h.code = '5EL' and o.is_active limit 1`,
    )).rows[0]?.code ?? null;

    /* Its own category on course 1, so nothing here depends on what some
       other file left on the real menu. */
    catId = (await db.query<{ id: string }>(
      `insert into pos_menu_categories (hotel_id, name, course)
       values ($1, 'Course Wire Test', 1) returning id::text`, [hotelId],
    )).rows[0]!.id;

    const mk = async (name: string, course: number | null) =>
      (await db.query<{ id: string }>(
        `insert into pos_menu_items
           (hotel_id, category_id, name, price, tax_rate, course)
         values ($1, $2, $3, 100, 5, $4) returning id::text`,
        [hotelId, catId, name, course],
      )).rows[0]!.id;

    starter = await mk("Wire Starter", null);   // inherits course 1
    main    = await mk("Wire Main", 2);         // overrides to 2
    drink   = await mk("Wire Drink", null);     // inherits 1 — fixed below
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    if (orderId) {
      await db.query(
        "alter table pos_order_lines disable trigger pos_order_lines_frozen");
      try {
        await db.query("delete from pos_orders where id = $1", [orderId]);
      } finally {
        await db.query(
          "alter table pos_order_lines enable trigger pos_order_lines_frozen");
      }
    }
    await db.query("delete from pos_menu_items where category_id = $1", [catId]);
    await db.query("delete from pos_menu_categories where id = $1", [catId]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("the pass knows which course a dish belongs to", () => {
  it("sends the course, resolved, with null for an unsequenced dish",
    async () => {
      if (!outlet || !starter || !main || !drink) {
        expect(outlet, "5EL needs an outlet").toBeTruthy();
        return;
      }

      /* The drink moves to a category with no course of its own, which
         is how a real menu carries one — drinks are not a course. */
      const db = await admin();
      try {
        const noCourse = (await db.query<{ id: string }>(
          `insert into pos_menu_categories (hotel_id, name)
           values ($1, 'Course Wire Drinks') returning id::text`, [hotelId],
        )).rows[0]!.id;
        await db.query(
          "update pos_menu_items set category_id = $1 where id = $2",
          [noCourse, drink]);
      } finally {
        await db.end();
      }

      const res = await call("/5EL/till/orders/batch", {
        outlet, table: "COURSE-WIRE", send: true,
        /* Rung up drink FIRST, deliberately: the order they were typed
           must not decide the order the pass shows them in. */
        lines: [
          { itemId: drink, qty: 1 },
          { itemId: main, qty: 1 },
          { itemId: starter, qty: 2 },
        ],
      });
      expect(res.status).toBe(200);
      orderId = ((await res.json()) as { id: string }).id;

      const lines = await pass();
      const byName = new Map(lines.map((l) => [l.name, l]));

      const s = byName.get("Wire Starter");
      const m = byName.get("Wire Main");
      const d = byName.get("Wire Drink");
      expect(s, "the starter is not on the pass").toBeTruthy();

      /* Inherited from its category. */
      expect(s!.course).toBe(1);
      /* Its own, overriding. */
      expect(m!.course).toBe(2);

      /* ⚠ NULL, NOT ZERO AND NOT MISSING. Zero sorts a lime soda ahead
         of the starters; a missing field prints "undefined" on a pass. */
      expect(d!.course).toBeNull();
      expect(Object.hasOwn(d!, "course")).toBe(true);
    });

  it("groups into the courses a table is waiting for, unsequenced last",
    async () => {
      if (!orderId) return;

      const db = await admin();
      try {
        const { rows } = await db.query<{ course: number | null; dishes: number }>(
          "select course, dishes from app.pos_order_courses($1)", [orderId],
        );

        /* Three groups: course 1, course 2, and the drink. */
        expect(rows.map((r) => r.course)).toEqual([1, 2, null]);

        /* The starter went on as qty 2 but is ONE dish on the board —
           a chef cooks a line, not a portion. */
        expect(rows[0]!.dishes).toBe(1);
      } finally {
        await db.end();
      }
    });
});
