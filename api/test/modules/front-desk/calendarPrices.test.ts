import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CALENDAR SHOWS EACH NIGHT'S OWN PRICE (the owner's D27-271, item 3)

   GET /:code/calendar-prices: each room type's price on each night of the
   window, the figure the Rates screen's main row shows - app.price_for on
   EP. The night's own price where one is set, else the type's standard
   (rack) price, else null, which the Calendar prints as a dash.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FCP";
let hotelId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Night = { type: string; date: string; price: number | null };
const nights = async () => {
  const res = await call("/calendar-prices?from=2026-08-26&days=3");
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Night[];
};
const on = (all: Night[], type: string, date: string) =>
  all.find((n) => n.type === type && n.date === date);

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Calendar Prices Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* The standard price: Standard's rack. Deluxe is priced nowhere. */
    await db.query(
      "update room_types set base_rate = 3000 where hotel_id = $1 and code = 'STD'", [hotelId]);
  } finally { await db.end(); }

  /* The night of the 27th has its own price, set as the Rates screen sets one. */
  const [std] = await sql<{ id: string }>(
    "select id::text from room_types where hotel_id = $1 and code = 'STD'", [hotelId]);
  const set = await call("/pricing/base", "PUT",
    { roomTypeId: std!.id, from: "2026-08-27", to: "2026-08-28", price: 2500 });
  expect(set.status, await set.clone().text()).toBe(200);
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
  } finally { await db.end(); }
  await closePool();
});

describe("D27-271 item 3 · the Calendar's price is the night's own", () => {
  it("a night with a date price shows that price", async () => {
    expect(on(await nights(), "Standard", "2026-08-27")?.price).toBe(2500);
  });

  it("a night without one shows the standard price", async () => {
    const all = await nights();
    expect(on(all, "Standard", "2026-08-26")?.price).toBe(3000);
    expect(on(all, "Standard", "2026-08-28")?.price).toBe(3000);
  });

  it("no price at all is null, a dash - never a zero", async () => {
    const all = await nights();
    for (const date of ["2026-08-26", "2026-08-27", "2026-08-28"]) {
      expect(on(all, "Deluxe", date), date).toEqual({ type: "Deluxe", date, price: null });
    }
  });

  it("is the Rates screen's main row, figure for figure (app.price_for, EP)", async () => {
    const all = await nights();
    const rates = (await (await call("/pricing?from=2026-08-26&days=3&plan=EP")).json()) as {
      roomTypes: { id: string; name: string }[];
      cells: { date: string; roomTypeId: string; price: number | null }[];
    };
    for (const c of rates.cells) {
      const name = rates.roomTypes.find((t) => t.id === c.roomTypeId)!.name;
      expect(on(all, name, c.date)?.price, `${name} ${c.date}`).toBe(c.price);
    }
  });

  it("refuses a window that is not a date", async () => {
    expect((await call("/calendar-prices?from=yesterday&days=3")).status).toBe(409);
  });
});
