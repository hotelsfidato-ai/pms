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

interface Stay { id: string; status: string; arrival: string; departure: string }

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
