import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GST A DISH SHOWS IS THE GST IT IS RUNG AT (POS-15, D21-94)

   A dish imported with its GST column blank has `tax_rate` NULL: it
   follows its section's heading, and `addOneLine` resolves that when
   the dish is rung. The menu read sent `Number(null)`, which is 0, so
   the Menu screen and the Terminal printed "0%" for a dish the till
   would charge 5% - or would refuse outright, when the section has no
   rule at all. The owner (D21-94): "Show the rate its section actually
   charges, or a dash where none is set."

   So the rate on the menu is compared with the rate on the LINE the
   till writes, not with a number typed here: the promise is that the
   screen and the bill cannot disagree.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
const cats: string[] = [];
let follows: string;   // no rate of its own, in a restaurant section
let unset: string;     // no rate of its own, in a section with no rule
let nought: string;    // its own 0%, in a section with no rule

const call = (path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function rateOnMenu(id: string): Promise<number | null | undefined> {
  const res = await call("/till/menu");
  const body = (await res.json()) as {
    categories: { items: { id: string; taxRate: number | null }[] }[];
  };
  return body.categories.flatMap((c) => c.items).find((i) => i.id === id)?.taxRate;
}

/** Ring one of the dish on a fresh order: the till's answer, or its refusal. */
async function ring(itemId: string, label: string) {
  const opened = await call("/till/orders", { outlet: "REST", table: `GSTWIRE ${label}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const order = (await opened.json()) as { id: string };
  const res = await call(`/till/orders/${order.id}/lines`, { itemId, qty: 1 });
  return {
    status: res.status,
    body: (await res.json()) as {
      reason?: string; lines?: { taxRate: number; voided: boolean }[];
    },
  };
}

beforeAll(async () => {
  const db = await admin();
  try {
    ownerUid = (await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    )).rows[0]!.uid;
    const hotel = (await db.query<{ id: string }>(
      "select id::text from hotels where code = '5EL'",
    )).rows[0]!.id;

    const section = async (name: string, kind: string | null) => {
      const id = (await db.query<{ id: string }>(
        `insert into pos_menu_categories (hotel_id, name, tax_kind)
         values ($1, $2, $3) returning id::text`, [hotel, name, kind],
      )).rows[0]!.id;
      cats.push(id);
      return id;
    };
    const dish = async (cat: string, name: string, rate: number | null) =>
      (await db.query<{ id: string }>(
        `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
         values ($1, $2, $3, 200, $4) returning id::text`, [hotel, cat, name, rate],
      )).rows[0]!.id;

    const food = await section("GST Wire Food", "restaurant");
    /* No heading: it falls to 'other', and 5EL has no rule for that. */
    const bare = await section("GST Wire Bare", null);
    follows = await dish(food, "GST Wire Follows", null);
    unset = await dish(bare, "GST Wire Unset", null);
    nought = await dish(bare, "GST Wire Nought", 0);
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query(
      `delete from pos_order_lines where order_id in
         (select id from pos_orders where table_ref like 'GSTWIRE%')`);
    await db.query("delete from pos_orders where table_ref like 'GSTWIRE%'");
    await db.query("delete from pos_menu_items where category_id = any($1::uuid[])", [cats]);
    await db.query("delete from pos_menu_categories where id = any($1::uuid[])", [cats]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("the GST a dish shows on the menu (POS-15, D21-94)", () => {
  it("is its section's rate when it has none of its own - the rate the till rings", async () => {
    const shown = await rateOnMenu(follows);
    const rung = await ring(follows, "follows");
    expect(rung.status, rung.body.reason).toBe(200);
    const line = rung.body.lines!.find((l) => !l.voided)!;

    /* 5EL's restaurant rule is 5% in the demo. Not 0, and not a guess. */
    expect(shown, "the menu shows a different rate from the bill").toBe(line.taxRate);
    expect(shown).toBe(5);
  });

  it("is null - a dash on screen - when its section has no rate set", async () => {
    /* `toBeNull`, not `toBeFalsy`: 0 is falsy, and 0 is the wrong answer. */
    expect(await rateOnMenu(unset)).toBeNull();
    /* And the till agrees there is nothing to charge it at. */
    const rung = await ring(unset, "unset");
    expect(rung.status).toBe(409);
    expect(rung.body.reason).toMatch(/has no GST rate/);
  });

  it("keeps a real 0% as 0, even in a section with no rule", async () => {
    expect(await rateOnMenu(nought)).toBe(0);
    const rung = await ring(nought, "nought");
    expect(rung.status, rung.body.reason).toBe(200);
    expect(rung.body.lines!.find((l) => !l.voided)!.taxRate).toBe(0);
  });
});
