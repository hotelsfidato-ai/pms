import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DESK'S READ (D27-313 (1), the owner, 13 October)

   GET /:code/stays sent every booking ever made - 793 on the demo, ~3.5 s -
   and Arrivals, In house, Due out and the check-in's room list each read it.
   With `from`/`to` it sends only the bookings checked in now and those
   arriving from..to: the same rows those screens kept, each exactly as the
   full list has it. Without them it is still every booking (All bookings,
   Find, the Calendar). Read-only, on the demo's 5EL.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

interface Stay { id: string; status: string; arrival: string; departure: string; roomNumber: string }

const get = async (path: string) => {
  const res = await app.request(`/api/hotels/5EL${path}`, { headers: { "x-dev-staff-id": "dev-owner" } });
  return { status: res.status, body: await res.json() as Stay[] };
};
const byId = (rows: Stay[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let today = "";
let all: Stay[] = [];

beforeAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    today = (await db.query<{ d: string }>(
      "select app.business_date(id)::text as d from hotels where code = '5EL'")).rows[0]!.d;
  } finally { await db.end(); }
  all = (await get("/stays")).body;
});
afterAll(async () => { await closePool(); });

const checkedIn = (s: Stay) => s.status === "in-house" || s.status === "due-out";

describe("GET /:code/stays?from&to - only what the desk shows", () => {
  it("today: everybody checked in and everybody arriving today, nothing else", async () => {
    const { status, body } = await get(`/stays?from=${today}&to=${today}`);
    expect(status).toBe(200);
    const wanted = all.filter((s) => checkedIn(s) || s.arrival === today);
    expect(byId(body)).toEqual(byId(wanted));

    /* The demo holds each kind, so the equality above is about something. */
    expect(body.some((s) => s.status === "in-house"), "an in-house guest").toBe(true);
    expect(body.some((s) => s.status === "due-out"), "a guest due out").toBe(true);
    expect(body.some((s) => s.status === "due-in" && s.arrival === today), "an arrival").toBe(true);
    const left = all.filter((s) => s.status === "checked-out" && s.arrival < today);
    const cancelled = all.filter((s) => s.status === "cancelled" && s.arrival !== today);
    expect(left.length, "old checked-out stays in the demo").toBeGreaterThan(0);
    expect(cancelled.length, "cancelled bookings in the demo").toBeGreaterThan(0);
    const ids = new Set(body.map((s) => s.id));
    expect(left.filter((s) => ids.has(s.id)), "an old checked-out stay sent").toEqual([]);
    expect(cancelled.filter((s) => ids.has(s.id)), "a cancelled booking sent").toEqual([]);
    expect(body.length).toBeLessThan(all.length);
  });

  it("`to` defaults to `from`", async () => {
    expect(byId((await get(`/stays?from=${today}`)).body))
      .toEqual(byId((await get(`/stays?from=${today}&to=${today}`)).body));
  });

  it("a range: Upcoming's fortnight, with whoever is checked in", async () => {
    const from = addDays(today, 1), to = addDays(today, 14);
    const { body } = await get(`/stays?from=${from}&to=${to}`);
    expect(byId(body)).toEqual(byId(all.filter((s) => checkedIn(s) || (s.arrival >= from && s.arrival <= to))));
  });

  it("without from it is still every booking", async () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((s) => s.status === "checked-out")).toBe(true);
    expect(all.some((s) => s.status === "cancelled")).toBe(true);
  });

  it("refuses a day that is not one", async () => {
    expect((await get("/stays?from=today")).status).toBe(400);
    expect((await get(`/stays?from=${today}&to=soon`)).status).toBe(400);
  });
});

/* THE BOARD'S READ (D27-316 (1), the owner): Rooms, the Calendar and the
   Dashboard read every booking ever made, once or twice each. With `board=1`
   they get every booking with a day in the window (arriving by `to`, leaving
   on or after `from`: a bar, a night sold, a departure today), whoever is
   checked in, and the bookings still to arrive that hold a room (a tile's
   Arriving and Reserved, whatever the window). That the screens draw the same
   from it as from every booking was compared on the 13 October copy. */
describe("GET /:code/stays?from&to&board=1 - only what the board draws", () => {
  const board = (from: string, to: string) =>
    all.filter((s) => checkedIn(s)
      || (s.arrival <= to && s.departure >= from)
      || (s.status === "due-in" && s.arrival >= today && s.roomNumber !== ""));

  it("the Calendar's fortnight: the window, who is in, and the rooms booked ahead", async () => {
    const to = addDays(today, 13);
    const { status, body } = await get(`/stays?from=${today}&to=${to}&board=1`);
    expect(status).toBe(200);
    expect(byId(body)).toEqual(byId(board(today, to)));
    /* More than the desk's read (a guest gone today, a booking over the
       window that arrived before it), less than every booking. */
    const desk = (await get(`/stays?from=${today}&to=${to}`)).body;
    expect(body.length).toBeGreaterThan(desk.length);
    expect(body.length).toBeLessThan(all.length);
  });

  it("a fortnight already past (the Calendar paged back) and one day (the Dashboard)", async () => {
    const from = addDays(today, -21), to = addDays(today, -8);
    expect(byId((await get(`/stays?from=${from}&to=${to}&board=1`)).body)).toEqual(byId(board(from, to)));
    const day = (await get(`/stays?from=${today}&to=${today}&board=1`)).body;
    expect(byId(day)).toEqual(byId(board(today, today)));
    /* Today's work: everybody arriving and everybody leaving today, the
       ones who have gone included. */
    const ids = new Set(day.map((s) => s.id));
    const leftToday = all.filter((s) => s.departure === today && s.status === "checked-out");
    expect(leftToday.length, "a guest who left today, in the demo").toBeGreaterThan(0);
    expect(all.filter((s) => s.arrival === today || s.departure === today).every((s) => ids.has(s.id))).toBe(true);
  });
});
