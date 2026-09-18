import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   AN UNPRICED ROOM IS NOT A FREE ROOM — INV-3

   `room_types.base_rate` is NULL until somebody prices the type (032).
   Two responses read it with `Number()`, and `Number(null)` is 0:

     GET /:code/rates        Rate performance — "rack ₹0"
     GET /:code/room-types   the old room-type list — "Rack rate ₹0"

   A channel manager fed from either would push ₹0 to the booking sites.
   The assertion that matters is `toBeNull()`, not "not zero": a figure
   of 0 is allowed by the column's CHECK, so once an API has flattened
   NULL into 0 nobody downstream can tell "free" from "not set".

   The priced type is asserted too, so the fix cannot pass by nulling
   everything.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let unpriced: { id: string; name: string; was: string | null };
let priced: { id: string; name: string; was: string | null; rate: number };

const as = (path: string) =>
  app.request(`/api/hotels${path}`, {
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
  });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;

    /* Two ACTIVE types with rooms, so both appear in both responses. */
    const { rows } = await db.query<{ id: string; name: string; base_rate: string | null }>(
      `select rt.id::text, rt.name, rt.base_rate::text
         from room_types rt join hotels h on h.id = rt.hotel_id
        where h.code = '5EL' and rt.is_active
          and exists (select 1 from rooms r where r.room_type_id = rt.id and r.is_active)
        order by rt.sort_order, rt.name`);
    expect(rows.length, "5EL needs two sellable room types").toBeGreaterThanOrEqual(2);

    unpriced = { id: rows[0]!.id, name: rows[0]!.name, was: rows[0]!.base_rate };

    /* The other one keeps (or is given, for the length of this file) a real
       figure. 4321 is nobody's price — it only has to be a number. */
    const other = rows[1]!;
    priced = {
      id: other.id, name: other.name, was: other.base_rate,
      rate: other.base_rate === null ? 4321 : Number(other.base_rate),
    };
    await db.query("update room_types set base_rate = $1 where id = $2",
      [priced.rate, priced.id]);

    await db.query("update room_types set base_rate = null where id = $1", [unpriced.id]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    /* Both back exactly as they were, NULL included. */
    await db.query("update room_types set base_rate = $1 where id = $2",
      [unpriced.was, unpriced.id]);
    await db.query("update room_types set base_rate = $1 where id = $2",
      [priced.was, priced.id]);
  } finally { await db.end(); }
  await closePool();
});

describe("an unpriced room type (INV-3)", () => {
  it("reads as null on Rate performance, on the row and on every date", async () => {
    const res = await as("/5EL/rates?from=2026-08-24&days=3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roomType: string; rackRate: number | null;
      cells: { date: string; rackRate: number | null }[];
    }[];

    const row = body.find((r) => r.roomType === unpriced.name)!;
    expect(row, `${unpriced.name} is missing from /rates`).toBeDefined();
    expect(row.rackRate, "an unpriced room type read as a figure").toBeNull();
    expect(row.cells).toHaveLength(3);
    for (const c of row.cells) {
      expect(c.rackRate, `${unpriced.name} on ${c.date}`).toBeNull();
    }

    const other = body.find((r) => r.roomType === priced.name)!;
    expect(other.rackRate).toBe(priced.rate);
    expect(other.cells.every((c) => c.rackRate === priced.rate)).toBe(true);
  });

  it("reads as null on the room-type list", async () => {
    const res = await as("/5EL/room-types?asOn=2026-08-25");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; rackRate: number | null }[];

    expect(body.find((t) => t.type === unpriced.name)!.rackRate,
      "an unpriced room type read as a figure").toBeNull();
    expect(body.find((t) => t.type === priced.name)!.rackRate).toBe(priced.rate);
  });
});
