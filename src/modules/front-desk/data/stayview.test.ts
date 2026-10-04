import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as apiModule from "@/lib/api";
import { getStayView, addDays, isWeekend } from "@/modules/front-desk/data/stayview";
import { listStays } from "@/modules/front-desk/data/stays";
import { defaultPropertyId, BUSINESS_DATE } from "@/data/repositories";

/* CP9: the id a screen puts in a URL is the hotel CODE, because that is
   what Postgres calls it — `hotels.code`, commented "appears in URLs" in
   migration 002. It used to be the fixture's slug. Screens did not change;
   they take whatever the repository hands them. */
const HOTEL = "5EL";
const OTHER = "some-other-property";

async function chart(start = BUSINESS_DATE) {
  const data = await getStayView(HOTEL, start, BUSINESS_DATE);
  if (!data) throw new Error("no chart");
  return data;
}

describe("tape chart - the window", () => {
  it("returns exactly fourteen dates", async () => {
    expect((await chart()).dates).toHaveLength(14);
  });

  it("starts on the date asked for", async () => {
    expect((await chart("2026-08-01")).dates[0]).toBe("2026-08-01");
  });

  it("marks Saturday and Sunday, and only those", () => {
    expect(isWeekend("2026-08-01")).toBe(true);  // Saturday
    expect(isWeekend("2026-08-02")).toBe(true);  // Sunday
    expect(isWeekend("2026-08-03")).toBe(false); // Monday
  });

  it("steps a week without drifting across a month boundary", () => {
    expect(addDays("2026-08-28", 7)).toBe("2026-09-04");
    expect(addDays("2026-09-04", -7)).toBe("2026-08-28");
  });

  it("refuses a hotel the user has no data for", async () => {
    expect(await getStayView(OTHER, BUSINESS_DATE, BUSINESS_DATE)).toBeNull();
  });
});

describe("tape chart - rooms and bars", () => {
  it("carries every physical room, so 308 can be shown under Blocked", async () => {
    const rooms = (await chart()).roomTypes.flatMap((t) => t.rooms);
    expect(rooms).toHaveLength(18);
    expect(rooms.filter((r) => r.outOfService)).toHaveLength(1);
  });

  it("counts seventeen sellable rooms, matching the Manager Report", async () => {
    expect((await chart()).counts.All).toBe(17);
  });

  it("never lets a bar start before or end after the window", async () => {
    const data = await chart();
    for (const type of data.roomTypes) {
      for (const room of type.rooms) {
        for (const bar of room.bars) {
          expect(bar.startIndex).toBeGreaterThanOrEqual(0);
          expect(bar.startIndex + bar.span).toBeLessThanOrEqual(14);
          expect(bar.span).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("never overlaps two live bars in one room", async () => {
    const data = await chart();
    for (const type of data.roomTypes) {
      for (const room of type.rooms) {
        const live = room.bars.filter((b) => b.tone !== "void");
        for (const a of live) {
          for (const b of live) {
            if (a === b) continue;
            const overlap =
              a.startIndex < b.startIndex + b.span && b.startIndex < a.startIndex + a.span;
            expect(overlap, `${a.stay.id} overlaps ${b.stay.id} in room ${room.number}`).toBe(false);
          }
        }
      }
    }
  });

  it("gives the day-use stay a single column", async () => {
    const data = await chart();
    const bar = data.roomTypes
      .flatMap((t) => t.rooms)
      .flatMap((r) => r.bars)
      .find((b) => b.stay.id === "stay-dayuse");
    expect(bar?.span).toBe(1);
  });

  it("tones the cancelled stay as void so it reads as never having happened", async () => {
    const data = await chart();
    const bar = data.roomTypes
      .flatMap((t) => t.rooms)
      .flatMap((r) => r.bars)
      .find((b) => b.stay.id === "stay-cancelled");
    expect(bar?.tone).toBe("void");
  });

  it("clips a stay that runs past the window rather than dropping it", async () => {
    /* 18–31 Aug: the stay runs 30 Aug – 1 Sep, so its last night falls outside. */
    const data = await chart("2026-08-18");
    const bar = data.roomTypes
      .flatMap((t) => t.rooms)
      .flatMap((r) => r.bars)
      .find((b) => b.stay.id === "stay-crossmonth");
    expect(bar).toBeDefined();
    expect(bar!.clippedEnd).toBe(true);
  });
});

describe("tape chart - counts agree with what they filter to", () => {
  /* The defect this prevents: a pill reading "Occupied 6" that filters
     to nine rows. Both must come from `room.state`. */
  it("derives every count from room state on the business date", async () => {
    const data = await chart();
    const rooms = data.roomTypes.flatMap((t) => t.rooms);
    const sellable = rooms.filter((r) => !r.outOfService);

    expect(data.counts.All).toBe(sellable.length);
    expect(data.counts.Vacant).toBe(sellable.filter((r) => !r.state.occupied).length);
    expect(data.counts.Occupied).toBe(sellable.filter((r) => r.state.occupied).length);
    expect(data.counts.Reserved).toBe(sellable.filter((r) => r.state.reserved).length);
    expect(data.counts["Due Out"]).toBe(sellable.filter((r) => r.state.dueOut).length);
    expect(data.counts.Blocked).toBe(rooms.filter((r) => r.outOfService).length);
  });

  it("has vacant and occupied account for every sellable room", async () => {
    const c = (await chart()).counts;
    expect(c.Vacant! + c.Occupied!).toBe(c.All);
  });
});

describe("tape chart - the footer", () => {
  it("gives one column per date", async () => {
    const data = await chart();
    expect(data.footer).toHaveLength(14);
    expect(data.footer.map((f) => f.date)).toEqual(data.dates);
  });

  it("never reports negative inventory or occupancy over 100%", async () => {
    for (const start of ["2026-08-01", "2026-08-08", BUSINESS_DATE]) {
      for (const f of (await chart(start)).footer) {
        expect(f.availableInventory).toBeGreaterThanOrEqual(0);
        expect(f.occupancyPct).toBeGreaterThanOrEqual(0);
        expect(f.occupancyPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("counts a night as the Manager report does: no day use, no no-show, nothing tentative (D27-151)", async () => {
    const data = await chart();
    const stays = await listStays(HOTEL);
    const sold = (d: string) => stays.filter((s) =>
      ["due-in", "in-house", "due-out", "checked-out"].includes(s.status) && !s.isDayUse
      && s.arrival <= d && d < s.departure).length;
    for (const f of data.footer) {
      expect(f.occupancyPct, f.date).toBe(Math.round((sold(f.date) / data.counts.All!) * 1000) / 10);
    }
  });

  it("reaches full occupancy on the two days the real month sold out", async () => {
    const data = await chart("2026-08-04");
    const full = data.footer.filter((f) => f.occupancyPct === 100).map((f) => f.date);
    expect(full).toContain("2026-08-09");
    expect(full).toContain("2026-08-10");
  });
});

describe("tape chart - room type groups", () => {
  it("shows availability and a rate for every type on every date", async () => {
    const data = await chart();
    for (const type of data.roomTypes) {
      expect(type.perDate).toHaveLength(14);
      for (const cell of type.perDate) {
        expect(cell.available).toBeGreaterThanOrEqual(0);
        /* This asserted `> 0`, which held only while the rate was
           invented in the frontend: `RACK[type] ?? 0` gave every
           property the same two prices and zero for anything else.

           The rate now comes from the hotel's own room type and may be
           NULL — a type nobody has priced. What must never happen is a
           zero, which reads as "this room is free" on a chart. */
        expect(cell.rate === null || cell.rate > 0).toBe(true);
      }
    }
  });

  it("never shows a zero rate - a dash is the honest answer", async () => {
    const data = await chart();
    const zeros = data.roomTypes
      .flatMap((t) => t.perDate)
      .filter((c) => c.rate === 0);
    expect(zeros.length, "a zero rate says the room is free").toBe(0);
  });

  it("groups into the types the property declares", async () => {
    const data = await chart();
    expect(data.roomTypes.map((t) => t.type).sort()).toEqual(["Deluxe", "Superior"]);
  });

  it("is reachable through the default property", async () => {
    expect(await defaultPropertyId()).toBe(HOTEL);
  });
});

/* D27-271 item 3: each night's own price, from the server's one read for the
   window (app.price_for, EP: the night's price, else the standard price, else
   null). The stub's rooms say Deluxe 3699 - the business date's price - which
   is what every night used to repeat. */
describe("tape chart - each night's own price (D27-271)", () => {
  const PRICES = `/api/hotels/${HOTEL}/calendar-prices`;
  let asked: string[] = [];

  beforeEach(() => {
    asked = [];
    const stub = apiModule.api;
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.split("?")[0] !== PRICES) return stub(url, init);
      asked.push(url);
      return [
        { type: "Deluxe", date: BUSINESS_DATE, price: 5200 },
        { type: "Deluxe", date: addDays(BUSINESS_DATE, 1), price: 3500 },
        { type: "Deluxe", date: addDays(BUSINESS_DATE, 2), price: null },
      ] as never;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const deluxe = async () => (await chart()).roomTypes.find((t) => t.type === "Deluxe")!.perDate;

  it("a night with a date price shows that price", async () => {
    expect((await deluxe())[0]).toMatchObject({ date: BUSINESS_DATE, rate: 5200 });
  });

  it("a night without one shows the standard price the server falls back to", async () => {
    expect((await deluxe())[1]!.rate).toBe(3500);
  });

  it("no price shows a dash (null), never the business date's price or a zero", async () => {
    expect((await deluxe())[2]!.rate).toBeNull();
    const superior = (await chart()).roomTypes.find((t) => t.type === "Superior")!.perDate;
    expect(superior.every((c) => c.rate === null)).toBe(true);
  });

  it("the window loads with one read", async () => {
    await chart();
    expect(asked).toEqual([`${PRICES}?from=${BUSINESS_DATE}&days=14`]);
  });
});
