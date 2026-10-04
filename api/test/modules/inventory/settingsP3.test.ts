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
