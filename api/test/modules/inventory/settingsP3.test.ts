import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ROOMS AND RATES IN THE SETTINGS CONSOLE (P3; D27-258, D27-263)

   A room type's new fields, kept fitting by the database; Remove only
   when nothing uses the type; rooms in order; a rate plan Off and the
   sources that sell it; meal plans by day. On 5 Elements, on a room type
   of this file's own, removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let owner = "";
let typeId = "";
let source = "";
let positions: { number: string; position: number }[] = [];

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async <T,>(res: Response) => (await res.json()) as T;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  source = (await sql<{ id: string }>("select id::text from booking_sources order by name limit 1"))[0]!.id;
  positions = await sql("select number, position from rooms r join hotels h on h.id = r.hotel_id where h.code = '5EL'");
  await sql("delete from room_types where hotel_id = (select id from hotels where code = '5EL') and code = 'P3T'");
  const made = await call("POST", "/room-types", { code: "P3T", name: "P3 Test Suite", baseOccupancy: 2, maxOccupancy: 4 });
  expect(made.status, await made.clone().text()).toBe(200);
  typeId = (await json<{ id: string }>(made)).id;
});

afterAll(async () => {
  await sql("delete from room_types where id = $1", [typeId]);
  for (const p of positions) {
    await sql("update rooms set position = $2 where number = $1 and hotel_id = (select id from hotels where code = '5EL')",
      [p.number, p.position]);
  }
  await sql("delete from hotel_meal_days where hotel_id = (select id from hotels where code = '5EL') and meal_plan = 'AI'");
  await closePool();
});

describe("a room type in the Settings console", () => {
  it("takes adults and children, beds, view, size and colour, and refuses children up to the total", async () => {
    const ok = await call("PATCH", `/room-types/${typeId}`, {
      baseChildren: 1, maxAdults: 3, maxChildren: 2, beds: "1 King", viewType: "Garden", sizeSqft: 320, colour: "#1F6F5C",
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const setup = await json<{ types: { id: string; maxChildren: number; colour: string; beds: string }[] }>(
      await call("GET", "/room-setup"));
    expect(setup.types.find((t) => t.id === typeId)).toMatchObject({ maxChildren: 2, colour: "#1f6f5c", beds: "1 King" });

    const tooMany = await call("PATCH", `/room-types/${typeId}`, { maxChildren: 4 });
    expect(tooMany.status).toBe(409);
    expect((await json<{ reason: string }>(tooMany)).reason).toMatch(/children fewer than the total/);
  });

  it("is removed only when nothing uses it (D27-263)", async () => {
    const used = (await sql<{ id: string }>(
      `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
        where h.code = '5EL' and exists (select 1 from rooms r where r.room_type_id = rt.id) limit 1`))[0]!.id;
    const refused = await call("DELETE", `/room-types/${used}`);
    expect(refused.status).toBe(409);
    expect((await json<{ reason: string }>(refused)).reason).toMatch(/cannot be removed\. Switch it Off/);

    const extra = await json<{ id: string }>(await call("POST", "/room-types", { code: "P3X", name: "P3 Spare" }));
    expect((await call("DELETE", `/room-types/${extra.id}`)).status).toBe(200);
    expect(await sql("select 1 from room_types where id = $1", [extra.id])).toEqual([]);
  });

  it("puts the rooms in the order they are dragged", async () => {
    const before = await json<{ rooms: { number: string }[] }>(await call("GET", "/room-setup"));
    const reversed = before.rooms.map((r) => r.number).reverse();
    expect((await call("PUT", "/rooms/order", { numbers: reversed })).status).toBe(200);
    const after = await json<{ rooms: { number: string }[] }>(await call("GET", "/room-setup"));
    expect(after.rooms.map((r) => r.number)).toEqual(reversed);
  });
});

describe("a rate plan's settings and its meal days", () => {
  it("switches a plan Off, chooses who sells it, and back to every source", async () => {
    expect((await call("PUT", `/plan-settings/${typeId}/CP`, { isActive: false, sources: [source] })).status).toBe(200);
    let got = await json<{ plans: { roomTypeId: string; mealPlan: string; isActive: boolean; sources: string[] }[] }>(
      await call("GET", "/plan-settings"));
    expect(got.plans.find((p) => p.roomTypeId === typeId && p.mealPlan === "CP"))
      .toMatchObject({ isActive: false, sources: [source] });

    expect((await call("PUT", `/plan-settings/${typeId}/CP`, { sources: [] })).status).toBe(200);
    got = await json(await call("GET", "/plan-settings"));
    expect(got.plans.find((p) => p.roomTypeId === typeId && p.mealPlan === "CP")?.sources, "every source again").toEqual([]);
  });

  it("keeps the days each meal is served, and refuses a day that is not one", async () => {
    expect((await call("PUT", "/meal-days/AI", { breakfast: ["brunch"], lunch: [], dinner: [] })).status).toBe(409);
    expect((await call("PUT", "/meal-days/AI",
      { breakfast: ["stay", "departure"], lunch: [], dinner: ["arrival", "stay"] })).status).toBe(200);
    const got = await json<{ mealDays: { mealPlan: string; breakfast: string[]; dinner: string[] }[] }>(
      await call("GET", "/plan-settings"));
    expect(got.mealDays.find((d) => d.mealPlan === "AI"))
      .toMatchObject({ breakfast: ["stay", "departure"], dinner: ["arrival", "stay"] });
  });
});

/* A JPEG's headers as a camera writes them (as admin's gallery test makes
   one): the server reads segments, not pixels. */
function jpeg(width: number, height: number): Buffer {
  const seg = (marker: number, body: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xc0, frame),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(64, 0x2a),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("a room type's photos and amenities", () => {
  it("keeps ten photos at most, in the order dragged, and deletes one", async () => {
    const data = jpeg(800, 600).toString("base64");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await call("POST", `/room-types/${typeId}/photos`, { data, caption: `View ${i}` });
      expect(res.status, await res.clone().text()).toBe(200);
      ids.push((await json<{ id: string }>(res)).id);
    }
    const eleventh = await call("POST", `/room-types/${typeId}/photos`, { data });
    expect(eleventh.status).toBe(409);
    expect((await json<{ reason: string }>(eleventh)).reason).toMatch(/10 photos, the most/);
    expect((await call("POST", `/room-types/${typeId}/photos`, { data: "bm90IGEgcGhvdG8=" })).status, "not a JPEG").toBe(409);

    expect((await call("PUT", `/room-types/${typeId}/photos/order`, { ids: [...ids].reverse() })).status).toBe(200);
    const listed = await json<{ photos: { id: string }[] }>(await call("GET", `/room-types/${typeId}/photos`));
    expect(listed.photos.map((p) => p.id)).toEqual([...ids].reverse());
    expect((await call("DELETE", `/room-types/${typeId}/photos/${ids[0]}`)).status).toBe(200);
    expect((await json<{ photos: unknown[] }>(await call("GET", `/room-types/${typeId}/photos`))).photos).toHaveLength(9);
  });

  it("takes its amenities from the one catalogue, switched-on ones only", async () => {
    const [on] = await sql<{ id: string }>(
      "insert into amenities (name) values ('P3 Test Kettle') on conflict do nothing returning id::text");
    const [off] = await sql<{ id: string }>(
      "insert into amenities (name, is_active) values ('P3 Test Off', false) on conflict do nothing returning id::text");
    try {
      expect((await call("PUT", `/room-types/${typeId}/amenities`, { amenityIds: [on!.id, off!.id] })).status).toBe(200);
      expect((await json<{ amenityIds: string[] }>(await call("GET", `/room-types/${typeId}/amenities`))).amenityIds)
        .toEqual([on!.id]);
    } finally {
      await sql("delete from room_type_amenities where room_type_id = $1", [typeId]);
      await sql("delete from amenities where id = any($1::uuid[])", [[on!.id, off!.id]]);
    }
  });
});

describe("a new booking keeps to the room type and its plans (D27-258 Q1, Q3, Q4)", () => {
  const book = async (line: Record<string, unknown>, sourceId = source) => {
    const res = await call("POST", "/bookings", {
      guestName: "P3 Limits Guest", checkIn: "2027-11-10", checkOut: "2027-11-11", bookingSourceId: sourceId,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 4000, ...line }],
    });
    return [res.status, ((await res.json()) as { reason?: string }).reason ?? ""] as const;
  };

  it("refuses more adults or children than the type takes, a plan switched off, and a source that does not sell it", async () => {
    expect(await book({ adults: 4 })).toEqual([409, "A P3 Test Suite takes 3 adults at most."]);
    expect(await book({ adults: 1, children: 3 })).toEqual([409, "A P3 Test Suite takes 2 children at most."]);
    /* CP was switched off above. */
    expect(await book({ mealPlan: "CP" })).toEqual([409, "P3 Test Suite on CP is switched off for new bookings."]);

    const other = (await sql<{ id: string }>("select id::text from booking_sources where id <> $1 limit 1", [source]))[0]!.id;
    expect((await call("PUT", `/plan-settings/${typeId}/EP`, { sources: [other] })).status).toBe(200);
    try {
      expect(await book({})).toEqual([409, "P3 Test Suite on EP is not sold through this source."]);
    } finally {
      await call("PUT", `/plan-settings/${typeId}/EP`, { sources: [] });
    }
  });
});

describe("a SAC code per tax kind (D27-258 Q6)", () => {
  it("keeps six digits per kind, refuses anything else, and clears to the default", async () => {
    type Kinds = { kinds: { kind: string; sac: string | null }[] };
    expect((await call("PUT", "/tax/restaurant/sac", { sacCode: "99633" })).status, "five digits").toBe(409);
    expect((await call("PUT", "/tax/restaurant/sac", { sacCode: "996331" })).status).toBe(200);
    let got = await json<Kinds>(await call("GET", "/tax"));
    expect(got.kinds.find((k) => k.kind === "restaurant")?.sac).toBe("996331");
    expect((await call("PUT", "/tax/restaurant/sac", { sacCode: null })).status).toBe(200);
    got = await json<Kinds>(await call("GET", "/tax"));
    expect(got.kinds.find((k) => k.kind === "restaurant")?.sac, "not said: the screen shows a dash").toBeNull();
  });
});
