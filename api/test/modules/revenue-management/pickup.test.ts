import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   PICKUP COUNTS THE REPORTS SERVICE'S ROOM-NIGHTS, AND NO OTHERS

   RM-1. This service was told, in its brief and again in D18-15, that
   there is ONE definition of every figure and it belongs to the
   reports service. Pickup was not built on 18 September because that
   definition could not be reached from here; R1 opened the door; the
   route imports the `NIGHTS` fragment rather than spelling
   `stay_nights` a second time.

   That is a claim, and this file is what makes it checkable:

     the route's `sold` and the reports service's own
     /statistics/daily `roomsSold` are the SAME number on every night
     of the window - not close, the same, and

     every pickup count is a SUBSET of it. `last1 <= last7 <= last30 <=
     sold` cannot hold by accident if the join counted a room-night the
     reports service does not count, or missed one that it does.

   THIS FILE WRITES NOTHING. It needs no fixture, so it leaves none
   behind, which is the whole of its teardown (root MEMORY 292 is about
   the other kind).
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
let ownerId: string;

const get = (path: string) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    headers: { "x-dev-staff-id": ownerId },
  });

interface Night {
  date: string; sold: number; last1: number; last7: number; last30: number;
}
interface Reply {
  from: string; to: string; businessDate: string;
  recordsFrom: string | null; nights: Night[];
}

/* The window: the property's own month, and the ninety nights after
   its own day - exactly what the screen asks for. */
let reply: Reply;
let window: { from: string; to: string };

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'",
  )).rows[0].id as string;

  const bd = (await sql(
    `select to_char(app.business_date(id), 'YYYY-MM-DD') as d
       from hotels where code = $1`, [HOTEL],
  )).rows[0].d as string;

  window = {
    from: `${bd.slice(0, 7)}-01`,
    to: new Date(Date.parse(`${bd}T00:00:00Z`) + 90 * 86_400_000)
      .toISOString().slice(0, 10),
  };

  const res = await get(`/revenue/pickup?from=${window.from}&to=${window.to}`);
  expect(res.status).toBe(200);
  reply = await res.json() as Reply;
});

afterAll(async () => { await closePool(); });

describe("pickup and the reports service count the same rooms", () => {
  it("answers for every night of the window it was asked for", () => {
    expect(reply.from).toBe(window.from);
    expect(reply.to).toBe(window.to);
    const nights = Math.round(
      (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`))
      / 86_400_000) + 1;
    expect(reply.nights).toHaveLength(nights);
    expect(reply.nights[0]!.date).toBe(window.from);
  });

  it("agrees with /statistics/daily about how many rooms are sold", async () => {
    /* THE WHOLE POINT OF R1. Both numbers are dailyFigures(); if this
       ever parts, one of the two services has grown a second
       definition of a room-night, which is how the Dashboard and the
       Manager report came to disagree in August. */
    const daily = await (await get(
      `/statistics/daily?from=${window.from}&to=${window.to}`,
    )).json() as Array<{ date: string; roomsSold: number }>;

    expect(reply.nights.map((n) => [n.date, n.sold]))
      .toEqual(daily.map((d) => [d.date, d.roomsSold]));

    /* And the fixture has rooms to disagree about. A window of ninety
       empty nights would pass the line above with nothing in it. */
    expect(reply.nights.reduce((t, n) => t + n.sold, 0)).toBeGreaterThan(0);
  });

  it("never picks up more rooms than are sold, on any night", () => {
    const wrong = reply.nights.filter(
      (n) => !(n.last1 <= n.last7 && n.last7 <= n.last30 && n.last30 <= n.sold),
    );
    expect(wrong).toEqual([]);
  });

  it("says which day this property's booking records start", () => {
    expect(reply.recordsFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts every room-night of a booking made after the business date", () => {
    /* THE DEMO'S OWN SHAPE, asserted so that a change to it explains
       itself rather than turning the check below into a tautology: the
       demo is loaded in one go, weeks after the business date the
       property is stopped at, so EVERY booking it holds was recorded
       after that day.

       A window is counted back from the property's own day and has no
       top: a booking taken after it was made more recently still. So
       on this fixture the one-day window must hold every sold
       room-night - which is the strongest statement this file can make
       about the join, that it counts exactly the room-nights the
       reports service counts and not one more or fewer. */
    expect(reply.recordsFrom! > reply.businessDate).toBe(true);
    expect(reply.nights.map((n) => n.last1)).toEqual(reply.nights.map((n) => n.sold));
  });
});

describe("it shows and it suggests - the route itself refuses to write", () => {
  it("answers a GET and nothing else", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request(`/api/hotels/${HOTEL}/revenue/pickup`, {
        method,
        headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
        body: "{}",
      });
      expect([res.status, method]).toEqual([404, method]);
    }
  });

  it("refuses a property that does not exist rather than answering nil", async () => {
    const res = await app.request("/api/hotels/ZZZ/revenue/pickup", {
      headers: { "x-dev-staff-id": ownerId },
    });
    expect(res.status).toBe(404);
  });
});
