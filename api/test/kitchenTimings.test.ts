import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN RECORDS ITSELF, THROUGH THE ROUTES

   `db/tests/suite.sql` proves the trigger and the arithmetic against
   the tables directly. This file proves the thing that actually has to
   be true: **a chef pressing a button on the pass leaves a timing
   behind**, without any route having been written to do it.

   That is the whole reason the recorder is a trigger. Four paths change
   `kot_status` today, and the fifth will be written by somebody who has
   not read migration 080. If timings depended on the routes remembering,
   this test is where that would show up — and it would show up as a
   report quietly missing rows, months later.

   ⚠ AND THE PASS CLOCK. `atPassSeconds` is null while a dish is
   cooking and a number once it is ready, because a dish still in a pan
   is not waiting on anybody. Nothing showed that number before, and it
   is the one that ruins food.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

interface KitchenLine {
  id: string; name: string; status: string;
  waitedSeconds: number;
  prepMinutes: number | null;
  atPassSeconds: number | null;
}

let ownerUid: string;
let outlet: string | null = null;
let itemId: string | null = null;
let orderId: string | null = null;
let lineId: string | null = null;

const call = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function kitchen(): Promise<KitchenLine[]> {
  const res = await call("/5EL/kitchen");
  const body = (await res.json()) as { lines: KitchenLine[] };
  return body.lines;
}

async function events(): Promise<{ status: string; by: string | null }[]> {
  const db = await admin();
  try {
    const { rows } = await db.query<{ status: string; by: string | null }>(
      `select status, by_staff::text as by from pos_line_events
        where line_id = $1 order by at, id`,
      [lineId],
    );
    return rows;
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  const db = await admin();
  try {
    ownerUid = (await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    )).rows[0]!.uid;

    const o = await db.query<{ code: string }>(
      `select o.code from pos_outlets o join hotels h on h.id = o.hotel_id
        where h.code = '5EL' and o.is_active limit 1`,
    );
    outlet = o.rows[0]?.code ?? null;

    /* A dish with a known estimate, so the pass has something to show.
       Its own, not a category default — this file must not depend on
       what some other file left on a category. */
    const it = await db.query<{ id: string }>(
      `update pos_menu_items set prep_minutes = 11
        where id = (select i.id from pos_menu_items i
                     join hotels h on h.id = i.hotel_id
                    where h.code = '5EL' and i.is_active
                      and not exists (select 1 from pos_item_variations v
                                       where v.item_id = i.id and v.is_active)
                    limit 1)
        returning id::text`,
    );
    itemId = it.rows[0]?.id ?? null;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    if (itemId) {
      await db.query(
        "update pos_menu_items set prep_minutes = null where id = $1", [itemId]);
    }
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
  } finally {
    await db.end();
  }
  await closePool();
});

describe("a chef pressing a button leaves a timing behind", () => {
  it("records the send, without the batch endpoint knowing about timings",
    async () => {
      if (!outlet || !itemId) {
        expect(outlet, "5EL needs an outlet and a plain dish").toBeTruthy();
        return;
      }

      const res = await call("/5EL/till/orders/batch", {
        outlet, table: "TIMING-WIRE", send: true,
        lines: [{ itemId, qty: 1 }],
      });
      expect(res.status).toBe(200);
      const order = (await res.json()) as {
        id: string; lines: { id: string; voided: boolean }[];
      };
      orderId = order.id;
      lineId = order.lines.find((l) => !l.voided)!.id;

      const rows = await events();
      expect(rows.map((r) => r.status)).toEqual(["sent"]);
      /* WHO sent it. A timing with nobody against it cannot settle an
         argument about the pass. */
      expect(rows[0]!.by).not.toBeNull();
    });

  it("shows the estimate on the pass, and no pass clock while it cooks",
    async () => {
      if (!lineId) return;

      let line = (await kitchen()).find((l) => l.id === lineId);
      expect(line, "the dish is not on the pass").toBeTruthy();
      expect(line!.prepMinutes).toBe(11);
      /* ⚠ NULL, NOT ZERO. A dish still in a pan is not waiting on a
         waiter, and "0s at the pass" would read as though it were. */
      expect(line!.atPassSeconds).toBeNull();

      expect((await call(`/5EL/kitchen/lines/${lineId}/preparing`, {}))
        .status).toBe(200);
      line = (await kitchen()).find((l) => l.id === lineId);
      expect(line!.atPassSeconds, "cooking is not waiting").toBeNull();
    });

  it("starts the pass clock the moment it is ready", async () => {
    if (!lineId) return;

    expect((await call(`/5EL/kitchen/lines/${lineId}/ready`, {}))
      .status).toBe(200);

    const line = (await kitchen()).find((l) => l.id === lineId);
    expect(line!.status).toBe("ready");
    /* A number now, and it may legitimately be 0 seconds — the dish was
       marked ready this instant. What matters is that it is not null. */
    expect(line!.atPassSeconds).not.toBeNull();
    expect(typeof line!.atPassSeconds).toBe("number");

    /* THE ASSERTION THIS FILE EXISTS FOR. Three button presses, three
       rows, and not one line of route code was written to record them. */
    expect((await events()).map((r) => r.status))
      .toEqual(["sent", "preparing", "ready"]);
  });

  it("keeps the dish that went backwards", async () => {
    if (!lineId) return;

    await call(`/5EL/kitchen/lines/${lineId}/preparing`, {});
    await call(`/5EL/kitchen/lines/${lineId}/ready`, {});

    /* Five rows, not three. Four columns would have overwritten the
       first ready or refused the move; the churn is the evidence that a
       dish was called ready before it was. */
    expect((await events()).map((r) => r.status))
      .toEqual(["sent", "preparing", "ready", "preparing", "ready"]);
  });
});
