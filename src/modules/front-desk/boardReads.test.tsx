import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import App from "@/App";
import * as apiModule from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories";
import { HOTEL, go, startSignedIn } from "@/test/app";
import { getStayView, addDays } from "./data/stayview";

/* ══════════════════════════════════════════════════════════════════
   ROOMS AND THE CALENDAR READ ONLY THE DATES THEY SHOW (D27-316 (1))

   The board read every booking ever made twice (its own list, and again for
   the open bills' stays) and Rooms a third time for the names under its
   tiles - 793 rows and ~3.5 s each on the demo. Now the board asks for its
   window (`board=1`) and Rooms' names for the day (the desk's read). Which
   rows those are is api/test/modules/front-desk/deskStays.test.ts; that the
   screens draw the same from them was compared on the 13 October copy.
   ══════════════════════════════════════════════════════════════════ */

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  const real = apiModule.api;
  vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
    asked.push(url);
    return real(url, init);
  }) as typeof real);
});
afterEach(() => vi.restoreAllMocks());

const stayReads = () => asked.filter((u) => u.split("?")[0]!.endsWith("/stays"));

describe("the board's reads", () => {
  it("the Calendar's fortnight is one read of that fortnight", async () => {
    await getStayView(HOTEL, BUSINESS_DATE, BUSINESS_DATE);
    expect(stayReads()).toEqual([
      `/api/hotels/${HOTEL}/stays?from=${BUSINESS_DATE}&to=${addDays(BUSINESS_DATE, 13)}&board=1`,
    ]);
  });

  it("Rooms reads its window and the day's names, never every booking", async () => {
    startSignedIn();
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    await waitFor(() => expect(stayReads().length).toBeGreaterThanOrEqual(2));
    expect(stayReads().filter((u) => !u.includes("?from=")), "a read of every booking").toEqual([]);
    expect(stayReads()).toContain(`/api/hotels/${HOTEL}/stays?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`);
  });
});
