import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  getProperty, listRooms, listAllRooms, defaultPropertyId,
  listStays, getStay, listArrivals, listInHouse, listDepartures,
  getFolio, listOpenFolios, listGroups, listGroupMembers,
  listDailyStatistics, getPeriodStatistics, getTodaySnapshot,
  queryKeys, BUSINESS_DATE,
} from "./index";

const OTHER_HOTEL = "some-other-property";

describe("the seam — scoping", () => {
  it("returns nothing for a hotel the user has no data for", async () => {
    expect(await getProperty(OTHER_HOTEL)).toBeNull();
    expect(await listRooms(OTHER_HOTEL)).toEqual([]);
    expect(await listAllRooms(OTHER_HOTEL)).toEqual([]);
    expect(await listStays(OTHER_HOTEL)).toEqual([]);
    expect(await listArrivals(OTHER_HOTEL)).toEqual([]);
    expect(await listInHouse(OTHER_HOTEL)).toEqual([]);
    expect(await listDepartures(OTHER_HOTEL)).toEqual([]);
    expect(await listOpenFolios(OTHER_HOTEL)).toEqual([]);
    expect(await listGroups(OTHER_HOTEL)).toEqual([]);
    expect(await listDailyStatistics(OTHER_HOTEL)).toEqual([]);
    expect(await getPeriodStatistics(OTHER_HOTEL)).toBeNull();
    expect(await getTodaySnapshot(OTHER_HOTEL)).toBeNull();
  });

  it("will not fetch one hotel's stay through another hotel's id", async () => {
    const id = (await defaultPropertyId());
    const mine = await listStays(id);
    expect(mine.length).toBeGreaterThan(0);
    expect(await getStay(OTHER_HOTEL, mine[0]!.id)).toBeNull();
    expect(await getFolio(OTHER_HOTEL, mine[0]!.id)).toBeNull();
  });

  it("never hands out a live reference to its own data", async () => {
    const id = await defaultPropertyId();
    const first = await listStays(id);
    first[0]!.guest = "MUTATED";
    const second = await listStays(id);
    expect(second[0]!.guest).not.toBe("MUTATED");
  });
});

describe("the seam — the front desk's lists", () => {
  it("pins the demo to the Night Audit's business date", () => {
    expect(BUSINESS_DATE).toBe("2026-08-25");
  });

  it("puts the day-use and the turnover departure in today's departures", async () => {
    const id = await defaultPropertyId();
    const out = await listDepartures(id);
    const ids = out.map((s) => s.id);
    expect(ids).toContain("stay-dayuse");
    expect(ids).toContain("stay-turn-out");
  });

  it("puts the turnover arrival in today's arrivals", async () => {
    const id = await defaultPropertyId();
    const ids = (await listArrivals(id)).map((s) => s.id);
    expect(ids).toContain("stay-turn-in");
  });

  it("excludes day-use stays from in-house", async () => {
    const id = await defaultPropertyId();
    const ids = (await listInHouse(id)).map((s) => s.id);
    expect(ids).not.toContain("stay-dayuse");
  });

  it("keeps the complimentary guest in house", async () => {
    const id = await defaultPropertyId();
    const ids = (await listInHouse(id)).map((s) => s.id);
    expect(ids).toContain("stay-comp");
  });

  it("surfaces the overpaid folio, negative balance first", async () => {
    const id = await defaultPropertyId();
    const open = await listOpenFolios(id);
    expect(open[0]!.balance).toBeLessThan(0);
    expect(open[0]!.stayId).toBe("stay-overpaid");
  });
});

describe("the seam — statistics reconcile to the Manager Report", () => {
  it("reports 431 available, 132 sold, 30.63% for the PTD window", async () => {
    const id = await defaultPropertyId();
    const s = (await getPeriodStatistics(id))!;
    expect(s.availableRoomNights).toBe(431);
    expect(s.roomsSold).toBe(132);
    expect(s.occupancyPct).toBeCloseTo(30.63, 1);
  });

  it("derives ADR and RevPAR that match the report", async () => {
    const id = await defaultPropertyId();
    const s = (await getPeriodStatistics(id))!;
    expect(s.adr).toBeCloseTo(3178.63, 0);
    expect(s.revpar).toBeCloseTo(973.5, 0);
  });
});

describe("the seam — group bookings", () => {
  it("returns three rooms on one reference", async () => {
    const id = await defaultPropertyId();
    const [group] = await listGroups(id);
    if (!group) throw new Error("no group in fixture");
    const members = await listGroupMembers(id, group.id);
    expect(members).toHaveLength(3);
    expect(new Set(members.map((m) => m.reference)).size).toBe(1);
  });
});

describe("Rule 5 — hotelId in every query key", () => {
  it("carries the hotel id in every key that is hotel-scoped", () => {
    const hotelId = "hotel-under-test";
    const built: unknown[][] = [
      [...queryKeys.property(hotelId)],
      [...queryKeys.rooms(hotelId)],
      [...queryKeys.stays(hotelId)],
      [...queryKeys.stay(hotelId, "s1")],
      [...queryKeys.arrivals(hotelId, "2026-08-25")],
      [...queryKeys.inHouse(hotelId, "2026-08-25")],
      [...queryKeys.departures(hotelId, "2026-08-25")],
      [...queryKeys.folio(hotelId, "s1")],
      [...queryKeys.openFolios(hotelId)],
      [...queryKeys.groups(hotelId)],
      [...queryKeys.groupMembers(hotelId, "g1")],
      [...queryKeys.dailyStatistics(hotelId, "a", "b")],
      [...queryKeys.periodStatistics(hotelId, "a", "b")],
      [...queryKeys.todaySnapshot(hotelId, "2026-08-25")],
    ];
    for (const key of built) {
      expect(key, `key ${JSON.stringify(key)} omits hotelId`).toContain(hotelId);
    }
  });

  it("keeps the property list unscoped, because it is the thing that lists hotels", () => {
    expect([...queryKeys.properties()]).not.toContain("hotel-under-test");
  });
});

describe("Rule 2 — nothing outside the seam reaches for a fixture", () => {
  /* This is the rule that makes the backend swappable. It is worth a
     test rather than a comment, because it fails silently otherwise. */
  const SRC = join(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("has no import of @/data/fixtures outside src/data", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes(join("src", "data")))
      .filter((f) => /from\s+["'](@\/data\/fixtures|.*\.\.\/fixtures)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), ""));
    expect(offenders, `these files bypass the repositories: ${offenders.join(", ")}`)
      .toEqual([]);
  });
});
