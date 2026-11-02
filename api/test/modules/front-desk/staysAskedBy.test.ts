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

type Stay = { id: string; source: string | null };
type Bill = { stayId: string | null; balance: number };

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
