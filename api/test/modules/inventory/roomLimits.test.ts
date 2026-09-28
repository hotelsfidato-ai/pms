import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   RT-4 · A ROOM'S NUMBER AND FLOOR (the owner, 28 September)

   QA added a room with a 60-character number on floor -5: sellable at
   once, the house and every occupancy figure one bigger, and a room
   cannot be deleted. The owner: a number is at most 10 letters and
   digits (and -); a floor is 0 to 99, or blank. Each refusal writes
   nothing.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let typeId = "";
let roomNumber = "";

const call = (method: string, path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;
const rooms = async () => Number((await sql<{ n: string }>(
  "select count(*)::text as n from rooms r join hotels h on h.id = r.hotel_id where h.code = '5EL'"))[0]!.n);

beforeAll(async () => {
  [{ id: typeId, number: roomNumber }] = await sql<{ id: string; number: string }>(
    `select rt.id::text, rm.number from rooms rm join room_types rt on rt.id = rm.room_type_id
       join hotels h on h.id = rm.hotel_id where h.code = '5EL' order by rm.number limit 1`,
  ) as [{ id: string; number: string }];
});

afterAll(async () => { await closePool(); });

describe("RT-4 · a room's number and floor", () => {
  it("refuses a number longer than 10, and a floor below 0, and adds nothing", async () => {
    const before = await rooms();
    const long = await call("POST", "/rooms", { number: "X".repeat(60), roomTypeId: typeId });
    expect(long.status).toBe(409);
    expect(await reasonOf(long)).toMatch(/at most 10 letters and digits/);
    const low = await call("POST", "/rooms", { number: "B-1", roomTypeId: typeId, floor: -5 });
    expect(low.status).toBe(409);
    expect(await reasonOf(low)).toMatch(/0 \(the ground floor\) to 99/);
    expect(await rooms()).toBe(before);
  });

  it("refuses a floor below 0 when a room is changed, and in a rooms file", async () => {
    const edit = await call("PATCH", `/rooms/${roomNumber}`, { floor: -5 });
    expect(edit.status).toBe(409);
    const file = await call("POST", "/rooms/import", { dryRun: true, rows: [
      { number: "Z-9", typeCode: "DLX", floor: "-5" }] });
    expect(((await file.json()) as { verdicts: { action: string; detail: string }[] }).verdicts[0])
      .toMatchObject({ action: "rejected", detail: expect.stringMatching(/0 \(the ground floor\) to 99/) });
  });
});
