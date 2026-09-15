import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { unitPriceOf } from "@/modules/pos/lib/pricing";

/* ══════════════════════════════════════════════════════════════════
   THE PAD'S ARITHMETIC AND THE SERVER'S MUST AGREE

   The owner decided the waiter sees a running total while taking the
   order, so a guest asking "how much is that?" gets an answer without
   a round trip to Mumbai. That put a pricing rule in two places, and a
   rule written in two places is the defect shape this codebase produces
   more often than any other.

   THIS IS THE TEST THAT MAKES THAT DECISION SURVIVABLE.

   It prices lines with `unitPriceOf` — the ACTUAL function the pad
   calls, imported, not copied — and with the actual server, and
   asserts the two agree. A test that reimplements the formula it is
   checking proves only that the copy agrees with itself.

   ⚠ THE SHAPES ARE NOT THE SAME ON EACH SIDE, which is the whole
   reason this can drift. The pad treats a dish and its sides as ONE
   line at one unit price. The server writes the sides as SEPARATE
   lines carrying `parentLineId`. So the comparison is at the order
   level: what the waiter was shown, against what the dishes came to on
   the bill.

   Not compared here, and deliberately: tax, discount, round-off,
   service. Those are the server's alone and the pad never guesses at
   them.

   IF YOU CHANGE HOW A DISH IS PRICED — in `pricing.ts`, in
   `addOneLine`, or in the database — this is the test that catches
   you. Do not delete it to make a build pass.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

/* The menu exactly as the pad receives it. Typed here rather than
   imported so this file does not depend on the frontend's barrel at
   runtime — the pricing function is the only thing that must be the
   real one. */
interface Addon { id: string; label: string; price: number; offUntil: string | null }
interface AddonGroup { id: string; label: string; minSelect: number; maxSelect: number | null; addons: Addon[] }
interface Variation { id: string; label: string; price: number }
interface Item {
  id: string; name: string; price: number; taxRate: number; isActive: boolean;
  shortCode: string | null; isVeg: boolean | null; isFavourite: boolean;
  offUntil: string | null; offReason: string | null;
  variations: Variation[]; addonGroups: AddonGroup[];
}

let ownerUid: string;
let outlet: string | null = null;
let items: Item[] = [];
const made: string[] = [];

const call = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerUid,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const s = await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    );
    ownerUid = s.rows[0]!.uid;

    const o = await db.query<{ code: string }>(
      `select o.code from pos_outlets o
         join hotels h on h.id = o.hotel_id
        where h.code = '5EL' and o.is_active limit 1`,
    );
    outlet = o.rows[0]?.code ?? null;
  } finally {
    await db.end();
  }

  /* THE MENU THE PAD WOULD HAVE CACHED. Read through the same endpoint
     the app reads, so a change to what that endpoint returns shows up
     here too. */
  const res = await call("/5EL/till/menu");
  const body = (await res.json()) as { categories: { items: Item[] }[] };
  items = body.categories.flatMap((c) => c.items).filter((i) => i.isActive);
});

afterAll(async () => {
  const db = await admin();
  try {
    for (const id of made) {
      await db.query("delete from pos_order_lines where order_id = $1", [id]);
      await db.query("delete from pos_orders where id = $1", [id]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

/** Sum a sent order the way a bill does: every live line, quantity
    times the price copied onto it. Add-on lines included — on this side
    they are lines of their own. */
function serverTotal(lines: { qty: number; unitPrice: number; voided: boolean }[]) {
  return lines
    .filter((l) => !l.voided)
    .reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
}

describe("the running total the waiter sees", () => {
  it("matches the server for plain dishes", async () => {
    const plain = items.filter(
      (i) => i.variations.length === 0 && i.addonGroups.length === 0,
    ).slice(0, 3);

    if (!outlet || plain.length < 2) {
      expect(outlet, "5EL needs an outlet and two plain dishes").toBeTruthy();
      return;
    }

    const pad = plain.map((item, n) => ({
      item, qty: n + 1,
      unitPrice: unitPriceOf(item, undefined, undefined),
    }));
    const padTotal = pad.reduce((s, l) => s + l.unitPrice * l.qty, 0);

    const res = await call(`/${"5EL"}/till/orders/batch`, {
      method: "POST",
      body: JSON.stringify({
        outlet, table: "PADSUM-1",
        lines: pad.map((l) => ({ itemId: l.item.id, qty: l.qty })),
      }),
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as {
      id: string; lines: { qty: number; unitPrice: number; voided: boolean }[];
    };
    made.push(order.id);

    expect(padTotal, "the pad showed a different figure from the bill")
      .toBe(serverTotal(order.lines));
  });

  it("matches the server for a dish sold by variation", async () => {
    const varied = items.find((i) => i.variations.length > 0);
    if (!outlet || !varied) return;

    const variation = varied.variations[0]!;
    const unit = unitPriceOf(varied, variation.id, undefined);

    /* The dish's own `price` column is meaningless once it has
       variations, and pricing from it would put a number on the bill
       that is on no menu. If these ever coincide the assertion below
       still holds, but this is the case worth stating. */
    expect(unit).toBe(variation.price);

    const res = await call("/5EL/till/orders/batch", {
      method: "POST",
      body: JSON.stringify({
        outlet, table: "PADSUM-2",
        lines: [{ itemId: varied.id, qty: 2, variationId: variation.id }],
      }),
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as {
      id: string; lines: { qty: number; unitPrice: number; voided: boolean }[];
    };
    made.push(order.id);

    expect(unit * 2, "a variation priced differently on the pad")
      .toBe(serverTotal(order.lines));
  });

  it("matches the server when sides are added", async () => {
    /* ⚠ THE CASE MOST LIKELY TO DRIFT. The pad folds sides into one
       unit price; the server writes them as their own lines. Two
       shapes, one number, and nothing but this test holding them
       together.

       ⚠ AND THE CASE THIS TEST ONCE MISSED. It first looked for a dish
       with sides AND NO VARIATIONS, found none — the menu's only dish
       with sides has variations too — and returned quietly. It passed
       with the bug deliberately reintroduced, which is the exact
       failure the "prove it in both directions" rule exists to catch.
       A guard that skips itself is not a guard.

       So: any dish with a side that is on today, variation included if
       it has one, and NO silent return. If the menu cannot exercise
       this, the test says so and fails. */
    const withSides = items.find(
      (i) => i.addonGroups.some((g) => g.addons.some((a) => !a.offUntil)),
    );

    expect(
      withSides,
      "no active dish on 5EL's menu has a side that is on today — "
      + "this test cannot check what it exists to check",
    ).toBeTruthy();
    expect(outlet, "5EL needs an active outlet").toBeTruthy();
    if (!withSides || !outlet) return;

    const sides = withSides.addonGroups
      .flatMap((g) => g.addons)
      .filter((a) => !a.offUntil)
      .slice(0, 2);
    const addonIds = sides.map((a) => a.id);
    const sidesCost = sides.reduce((sum, a) => sum + a.price, 0);
    expect(sidesCost, "the sides picked are all free — nothing to check")
      .toBeGreaterThan(0);

    /* The variation, when the dish is sold by one. The database refuses
       a line without it, and the dish's own price column is meaningless
       once variations exist. */
    const variationId = withSides.variations[0]?.id;
    const base = variationId
      ? withSides.variations[0]!.price
      : withSides.price;

    const unit = unitPriceOf(withSides, variationId, addonIds);
    expect(unit, "the sides were not added to the dish's price")
      .toBe(base + sidesCost);

    const res = await call("/5EL/till/orders/batch", {
      method: "POST",
      body: JSON.stringify({
        outlet, table: "PADSUM-3",
        lines: [{
          itemId: withSides.id, qty: 3,
          ...(variationId ? { variationId } : {}),
          addonIds,
        }],
      }),
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as {
      id: string; lines: { qty: number; unitPrice: number; voided: boolean }[];
    };
    made.push(order.id);

    /* More lines than the one dish sent, because each side is its own
       line on this side of the wire. If that ever stops being true the
       assertion below still holds — but this is what makes the two
       shapes visible in the failure output. */
    expect(order.lines.filter((l) => !l.voided).length)
      .toBeGreaterThan(1);

    expect(unit * 3, "the pad and the bill disagree once sides are on")
      .toBe(serverTotal(order.lines));
  });
});
