import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   HOW LONG A DISH TAKES, THROUGH THE WIRE

   The database's own assertions live in `db/tests/suite.sql` and cover
   the fallback and the range. This file covers what a SCREEN receives,
   which is a different question and the one that went wrong first: the
   menu screen rendered the literal string "undefined min" because a
   persisted response predated the field.

   ⚠ THE ASSERTIONS THAT MATTER ARE THE NULL ONES. An untimed dish must
   come back as `null` — present in the payload, and not a number. Both
   halves matter:

     absent      a client reads `undefined`, and "undefined min" is what
                 the screen printed
     zero        a kitchen display reads "instant", sorts the dish to
                 the front of the pass, and a chef starts it last

   Neither is what "nobody has timed this" means, and both look like an
   answer.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

interface Item {
  id: string; name: string;
  prepMinutes: number | null;
  ownPrepMinutes: number | null;
}
interface Category {
  id: string; name: string;
  prepMinutes: number | null;
  items: Item[];
}

let ownerUid: string;
let catId: string | null = null;
let dishA: string | null = null;
let dishB: string | null = null;

const call = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function menu(): Promise<Category[]> {
  const res = await call("/5EL/till/menu");
  const body = (await res.json()) as { categories: Category[] };
  return body.categories;
}

/** The category this file owns, read fresh each time. */
const mine = async () =>
  (await menu()).find((c) => c.id === catId)!;

beforeAll(async () => {
  const db = await admin();
  try {
    ownerUid = (await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    )).rows[0]!.uid;

    const hotel = (await db.query<{ id: string }>(
      "select id::text from hotels where code = '5EL'",
    )).rows[0]!.id;

    /* Its own category, so the numbers set here cannot move a dish some
       other file is asserting about. */
    catId = (await db.query<{ id: string }>(
      `insert into pos_menu_categories (hotel_id, name)
       values ($1, 'Prep Wire Test') returning id::text`, [hotel],
    )).rows[0]!.id;

    dishA = (await db.query<{ id: string }>(
      `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
       values ($1, $2, 'Prep Wire A', 100, 5) returning id::text`,
      [hotel, catId],
    )).rows[0]!.id;

    dishB = (await db.query<{ id: string }>(
      `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
       values ($1, $2, 'Prep Wire B', 100, 5) returning id::text`,
      [hotel, catId],
    )).rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from pos_menu_items where category_id = $1", [catId]);
    await db.query("delete from pos_menu_categories where id = $1", [catId]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("preparation times over the wire", () => {
  it("sends null for an untimed dish — present, and not a number", async () => {
    const cat = await mine();
    const a = cat.items.find((i) => i.id === dishA)!;

    /* `toBeNull` rather than `toBeFalsy`: zero is falsy, and zero is the
       exact wrong answer this whole feature is shaped around. */
    expect(a.prepMinutes).toBeNull();
    expect(a.ownPrepMinutes).toBeNull();
    expect(cat.prepMinutes).toBeNull();

    /* The FIELD must exist. A screen reading `undefined` printed
       "undefined min", which is how this test came to be written. */
    expect(Object.hasOwn(a, "prepMinutes")).toBe(true);
    expect(Object.hasOwn(a, "ownPrepMinutes")).toBe(true);
  });

  it("a category default reaches its dishes, and says how many", async () => {
    const res = await call(`/5EL/till/menu/categories/${catId}/prep`,
      { minutes: 15 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dishesAffected: number };

    /* Both dishes are untimed, so both move. A default that changes
       nothing because every dish overrides it is worth saying out loud
       — otherwise somebody sets it, sees nothing, and concludes the
       feature is broken. */
    expect(body.dishesAffected).toBe(2);

    const cat = await mine();
    expect(cat.prepMinutes).toBe(15);
    for (const i of cat.items) {
      expect(i.prepMinutes, `${i.name} did not inherit`).toBe(15);
      /* INHERITED, not chosen here — the distinction the screen needs to
         show a clear as having done something. */
      expect(i.ownPrepMinutes).toBeNull();
    }
  });

  it("a dish overrides its category, and clearing falls back", async () => {
    expect((await call(`/5EL/till/menu/items/${dishA}/prep`,
      { minutes: 3 })).status).toBe(200);

    let cat = await mine();
    let a = cat.items.find((i) => i.id === dishA)!;
    let b = cat.items.find((i) => i.id === dishB)!;
    expect(a.prepMinutes).toBe(3);
    expect(a.ownPrepMinutes).toBe(3);
    expect(b.prepMinutes, "the other dish must not move").toBe(15);

    /* NULL CLEARS, and it is a real act rather than a no-op: the dish
       falls back to its category. */
    const cleared = await call(`/5EL/till/menu/items/${dishA}/prep`,
      { minutes: null });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as {
      prepMinutes: number | null; ownPrepMinutes: number | null;
    };
    /* The reply says what the kitchen will now see — which after a clear
       is the category's number, not nothing. */
    expect(body.ownPrepMinutes).toBeNull();
    expect(body.prepMinutes).toBe(15);

    cat = await mine();
    a = cat.items.find((i) => i.id === dishA)!;
    expect(a.prepMinutes).toBe(15);
    expect(a.ownPrepMinutes).toBeNull();
  });

  it("refuses zero, a typo, and a sentence", async () => {
    for (const minutes of [0, 481, -5]) {
      const res = await call(`/5EL/till/menu/items/${dishA}/prep`, { minutes });
      expect(res.status, `${minutes} was accepted`).not.toBe(200);
    }

    /* Not a number at all. The refusal has to say what to send instead,
       or a screen retries it. */
    const res = await call(`/5EL/till/menu/items/${dishA}/prep`,
      { minutes: "ten" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/whole number/i);

    /* A MISSING FIELD IS NOT A CLEAR. A screen that forgot to send it
       would otherwise silently wipe a time somebody set. */
    const absent = await call(`/5EL/till/menu/items/${dishA}/prep`, {});
    expect(absent.status).toBe(409);
  });

  it("still reads 15 after all of that", async () => {
    /* The refusals above must have changed nothing. A guard that
       refuses and writes anyway is worse than no guard. */
    const cat = await mine();
    const a = cat.items.find((i) => i.id === dishA)!;
    expect(a.prepMinutes).toBe(15);
    expect(a.ownPrepMinutes).toBeNull();
  });
});
