import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BOUNDED READS OF THE STAYS (D27-387, the load test)

   The Folios page and Walk-ins read every booking ever and kept a few.
   Each asks for its own rows now, and they must be the same rows: every
   stay GET /folios lists, and every walk-in, nothing lost.
   ══════════════════════════════════════════════════════════════════ */

const get = async <T,>(path: string) =>
  (await (await app.request(`/api/hotels/5EL${path}`, {
    headers: { "x-dev-staff-id": "dev-owner" },
  })).json()) as T;

type Stay = {
  id: string; source: string | null; guest: string; reference: string;
  roomNumber: string; phone: string | null; arrival: string; departure: string;
};
type Bill = { stayId: string | null; balance: number };

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

afterAll(() => closePool());

describe("the stays by their own question", () => {
  it("owing=1 holds every stay with a balance on GET /folios, and no other", async () => {
    const bills = await get<Bill[]>("/folios");
    const stays = await get<Stay[]>("/stays?owing=1");
    const owed = bills.flatMap((b) => (b.stayId ? [b.stayId] : []));
    expect(owed.length).toBeGreaterThan(0);
    expect(stays.map((s) => s.id).sort()).toEqual([...new Set(owed)].sort());
  });

  it("source=Walk-in holds exactly the walk-ins of the whole list", async () => {
    const all = await get<Stay[]>("/stays");
    const walkIns = await get<Stay[]>("/stays?source=Walk-in");
    const expected = all.filter((s) => s.source === "Walk-in").map((s) => s.id).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(all.length);
    expect(walkIns.map((s) => s.id).sort()).toEqual(expected);
  });
});

/* ALL BOOKINGS (the owner's D27-387): it opens on the last 90 days and what is
   ahead, and a search still reaches every booking ever made. */
describe("All bookings' window and search", () => {
  it("since= is every booking leaving on or after the day", async () => {
    const all = await get<Stay[]>("/stays");
    const day = [...all].sort((a, b) => a.departure.localeCompare(b.departure))[Math.floor(all.length / 2)]!.departure;
    const since = await get<Stay[]>(`/stays?since=${day}`);
    const expected = all.filter((s) => s.departure >= day).map((s) => s.id).sort();
    expect(expected.length).toBeLessThan(all.length);
    expect(since.map((s) => s.id).sort()).toEqual(expected);
  });

  it("q= finds the oldest booking, and exactly what the screen's own search would", async () => {
    const all = await get<Stay[]>("/stays");
    const oldest = [...all].sort((a, b) => a.arrival.localeCompare(b.arrival))[0]!;
    const q = oldest.guest.split(" ").at(-1)!.slice(0, 4).toLowerCase();
    const found = await get<Stay[]>(`/stays?q=${encodeURIComponent(q)}`);
    expect(found.map((s) => s.id)).toContain(oldest.id);
    /* The screen's rule (pages/Reservations.tsx), on every booking. */
    const screen = all.filter((s) => s.guest.toLowerCase().includes(q)
      || s.reference.toLowerCase().includes(q) || s.roomNumber.toLowerCase().includes(q));
    const theirs = new Set(found.map((s) => s.id));
    for (const s of screen) expect(theirs.has(s.id), s.reference).toBe(true);
  });

  it("finds the oldest booking by four digits of the phone, however it was typed", async () => {
    const all = await get<Stay[]>("/stays");
    const oldest = [...all].sort((a, b) => a.arrival.localeCompare(b.arrival))[0]!;
    const { rows: [g] } = await sql(
      "select g.id::text, g.phone from guests g join reservations r on r.guest_id = g.id where r.id = $1", [oldest.id]);
    await sql("update guests set phone = '+91 98765-43210' where id = $1", [g.id]);
    try {
      const found = await get<Stay[]>("/stays?q=5432");
      expect(found.map((s) => s.id)).toContain(oldest.id);
    } finally {
      await sql("update guests set phone = $2 where id = $1", [g.id, g.phone]);
    }
  });

  it("refuses a since that is not a day", async () => {
    const res = await app.request("/api/hotels/5EL/stays?since=soon", { headers: { "x-dev-staff-id": "dev-owner" } });
    expect(res.status).toBe(400);
  });
});
