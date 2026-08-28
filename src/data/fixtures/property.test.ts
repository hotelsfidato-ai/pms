import { describe, it, expect } from "vitest";
import {
  property,
  roomInventory,
  BASE_ROOM_COUNT,
  PHYSICAL_ROOM_COUNT,
  EXTRA_ROOM_DATES,
  dailyOccupancy,
  dailyAvailableRooms,
  nightsSoldPerDay,
} from "./property";

/* ══════════════════════════════════════════════════════════════════
   The fixture module runs its own calibration assertions at import
   time. Importing it here is what makes those assertions reachable —
   without a test that loads the module, the throw never executes and
   the check is decoration.
   ══════════════════════════════════════════════════════════════════ */

const PTD_END = "2026-08-25";
const ptdDates = Object.keys(dailyAvailableRooms).filter((d) => d <= PTD_END);
const sum = (o: Record<string, number>, keys: string[]) =>
  keys.reduce((t, k) => t + (o[k] ?? 0), 0);

describe("property fixture — inventory", () => {
  it("sells 17 rooms on an ordinary day, from one source", () => {
    /* The Manager Report's "Total Room 17" was taken on 25 August, when
       308 was out of service. 18 rooms exist physically. */
    expect(BASE_ROOM_COUNT).toBe(17);
    expect(PHYSICAL_ROOM_COUNT).toBe(18);
    expect(property.rooms).toBe(BASE_ROOM_COUNT);
  });

  it("holds exactly one room out of service", () => {
    const ooo = roomInventory.filter((r) => r.status === "out-of-service");
    expect(ooo).toHaveLength(1);
    expect(ooo[0]!.number).toBe("308");
  });

  it("returns the held room to inventory on the six days availability is 18", () => {
    expect(EXTRA_ROOM_DATES).toHaveLength(6);
    for (const date of EXTRA_ROOM_DATES) {
      expect(dailyAvailableRooms[date]).toBe(18);
    }
  });

  it("has no duplicate room numbers", () => {
    const numbers = roomInventory.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("only uses room types the property declares", () => {
    for (const room of roomInventory) {
      expect(property.roomTypes).toContain(room.type);
    }
  });
});

describe("property fixture — calibration against the Manager Report", () => {
  /* Source: Manager Report, "As on Date 25/08/2026  PTD 01/08/2026".
     PTD covers 1–25 August — 25 days, not the full month. */

  it("matches 431 available room-nights across the PTD window", () => {
    expect(sum(dailyAvailableRooms, ptdDates)).toBe(431);
  });

  it("matches 132 nights sold across the PTD window", () => {
    expect(sum(nightsSoldPerDay, ptdDates)).toBe(132);
  });

  it("yields the reported 30.63% mean occupancy", () => {
    const mean =
      (sum(nightsSoldPerDay, ptdDates) / sum(dailyAvailableRooms, ptdDates)) * 100;
    expect(mean).toBeCloseTo(30.63, 1);
  });

  it("records the same figures in _calibration", () => {
    expect(property._calibration.totalAvailableRoomNightsPTD).toBe(431);
    expect(property._calibration.totalNightsSoldPTD).toBe(132);
    expect(property._calibration.meanOccupancyPctPTD).toBeCloseTo(30.63, 1);
  });
});

describe("property fixture — occupancy shape", () => {
  it("never sells more rooms than exist on any day", () => {
    for (const [date, sold] of Object.entries(nightsSoldPerDay)) {
      expect(sold).toBeLessThanOrEqual(dailyAvailableRooms[date] ?? 0);
    }
  });

  it("swings across the full range rather than sitting flat", () => {
    const values = Object.values(dailyOccupancy);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(100);
  });

  it("keeps the empty days and the full days the real month had", () => {
    const values = Object.values(dailyOccupancy);
    expect(values.filter((v) => v === 0).length).toBeGreaterThanOrEqual(3);
    expect(values.filter((v) => v === 100).length).toBeGreaterThanOrEqual(2);
  });

  it("raises inventory to 18 only on 8–13 August", () => {
    const eighteens = Object.entries(dailyAvailableRooms)
      .filter(([, n]) => n === 18)
      .map(([d]) => d);
    expect(eighteens).toEqual([
      "2026-08-08", "2026-08-09", "2026-08-10",
      "2026-08-11", "2026-08-12", "2026-08-13",
    ]);
  });
});

describe("property fixture — demo identifiers are obviously fake", () => {
  it("does not carry a plausible real GSTIN", () => {
    /* A GSTIN prints on tax invoices. An invented-but-plausible one on a
       document that looks real is a hazard, not a placeholder. */
    expect(property.gstin).toBe("27AAAAA0000A1Z5");
  });

  it("declares both invoice series seen in production", () => {
    expect(property.invoiceSeries).toHaveLength(2);
    expect(property.invoiceSeries[0]!.prefix).toBe("5EFH");
  });
});
