import { describe, it, expect, vi, afterEach } from "vitest";
import * as apiModule from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories";
import { HOTEL as id } from "@/test/app";
import { listInHouse } from "@/modules/front-desk";
import { listHousekeeping } from "./data/housekeeping";

/* THE BOARD READS THE DAY'S ROWS (D27-387, the load test). Housekeeping read
   every booking ever made on its 30-60 s timer, 21.8 s at three years; it needs
   only who is in the house. Moved here from front-desk's deskRead.test.ts on
   2 November: a service's test reads another only through its front door. */

afterEach(() => vi.restoreAllMocks());

describe("the housekeeping board", () => {
  it("on its timer, reads the day's rows and still names who is in", async () => {
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
