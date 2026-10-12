import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE ROUNDING, WHEN IT IS PRINTED (D27-308 (1c), 12 October)

   The month's RevPAR read ₹559 in All properties' dark panel and ₹560
   in the same property's row. The panel worked it out from the totals;
   the row printed /statistics/period's `revpar`, which the server had
   already rounded to the paisa (559.497 → 559.50) before the screen
   rounded it to the rupee. The period's rates now come back exact, as
   the totals give them, and every screen rounds once.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let ownerId: string;

beforeAll(async () => {
  const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    ownerId = (await pool.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
  } finally { await pool.end(); }
});

afterAll(async () => { await closePool(); });

describe("the period's average rate and RevPAR", () => {
  it("come back as the totals give them, not rounded to the paisa first", async () => {
    const res = await app.request("/api/hotels/5EL/statistics/period?from=2026-08-01&to=2026-08-25",
      { headers: { "x-dev-staff-id": ownerId } });
    expect(res.status).toBe(200);
    const p = (await res.json()) as {
      availableRoomNights: number; roomsSold: number; roomRevenue: number; adr: number; revpar: number;
    };
    expect(p.roomsSold, "the demo sold rooms in August").toBeGreaterThan(0);

    const adr = p.roomRevenue / p.roomsSold;
    /* A rate that is whole paise proves nothing about rounding. */
    expect(Math.round(adr * 100) / 100, "the demo's August ADR is not whole paise").not.toBe(adr);
    expect(p.adr).toBe(adr);
    expect(p.revpar).toBe(p.roomRevenue / p.availableRoomNights);
  });
});
