import { describe, it, expect, vi, afterEach } from "vitest";
import * as apiModule from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories";
import { HOTEL as id } from "@/test/app";
import { listArrivals, listInHouse, listDepartures } from "./data/stays";
import { assignableRooms } from "./data/operations";
import { listHousekeeping } from "@/modules/housekeeping/data/housekeeping";

/* ══════════════════════════════════════════════════════════════════
   THE DESK READS ONLY THE DESK'S ROWS (D27-313 (1), the owner)

   Arrivals, In house, Due out and the check-in's room list each read every
   booking ever made - 793 and ~3.5 s on the demo - so the Check in button
   stayed grey for seconds on every open. Each asks the server for the day's
   rows now (`?from&to`: who is checked in, who arrives); which rows those
   are is api/test/modules/front-desk/deskStays.test.ts. The lists' own
   filters are the seam test's (repositories.test.ts).
   ══════════════════════════════════════════════════════════════════ */

afterEach(() => vi.restoreAllMocks());

describe("the desk's lists", () => {
  it("ask the stays read for the business date only, and the room list still knows who is in", async () => {
    const asked: string[] = [];
    const real = apiModule.api;
    vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      asked.push(url);
      return real(url, init);
    }) as never);

    await listArrivals(id);
    const inHouse = await listInHouse(id);
    await listDepartures(id);
    const rooms = [
      ...await assignableRooms(id, "Deluxe", BUSINESS_DATE),
      ...await assignableRooms(id, "Superior", BUSINESS_DATE),
    ];

    const reads = asked.filter((u) => u.split("?")[0]!.endsWith("/stays"));
    expect(reads.length).toBe(5);
    expect(reads.filter((u) => !u.endsWith(`/stays?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`)),
      "a desk list read every booking").toEqual([]);

    /* Who is in a room, by status (MEMORY 3): the check-in refuses it in words,
       naming a guest checked in there (a turnover room holds two). */
    const occupied = rooms.filter((r) => r.label === "Occupied");
    expect(occupied.length).toBeGreaterThan(0);
    for (const r of occupied) {
      expect(inHouse.filter((s) => s.roomNumber === r.number).map((s) => `${s.guest} is in this room.`))
        .toContain(r.reason);
    }
  });

  it("the housekeeping board, on its timer, reads the day's rows and still names who is in (D27-387)", async () => {
    const asked: string[] = [];
    const real = apiModule.api;
    vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      asked.push(url);
      return real(url, init);
    }) as never);

    const board = await listHousekeeping(id, BUSINESS_DATE);
    expect(asked.filter((u) => u.split("?")[0]!.endsWith("/stays")))
      .toEqual([`/api/hotels/${id}/stays?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`]);
    const inHouse = await listInHouse(id);
    expect(inHouse.length).toBeGreaterThan(0);
    for (const s of inHouse) {
      expect(board.find((r) => r.number === s.roomNumber)?.guest).toBeTruthy();
    }
  });
});
