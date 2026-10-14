import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import type { Stay } from "@/data/repositories";
import { HOTEL, startSignedIn } from "@/test/app";
import { listArrivals, listVacant } from "./stays";
import ArrivalsPage from "../pages/Arrivals";

/* ══════════════════════════════════════════════════════════════════
   A VOIDED BOOKING IS NOT EXPECTED (the owner's D27-326 (1), FD-32's note)

   The API says `void`, which StayStatus does not name, so every list that
   filtered `!== "cancelled"` let it through: Upcoming listed a voided booking
   with a "Void" pill and counted it in "15 expected". Arrivals Today,
   Upcoming and the free-room read (`listVacant`) leave it out as they leave
   out a cancelled one. The Dashboard's tile is reports' dashboard.test.tsx;
   a guest's next stay is api/test/modules/guests/directoryNextStay.test.ts.

   In data/, beside stays.ts: a test outside the seam that imports
   `listVacant` counts as its caller in repositories.test.ts's Rule 2b, and
   it still has no screen.
   ══════════════════════════════════════════════════════════════════ */

const BD = "2026-08-25";
const stub = apiModule.api;
let extra: Stay[] = [];

/** A booking somebody entered twice and voided, arriving `arrival`. */
async function voided(arrival: string, departure: string): Promise<Stay> {
  const [base] = await stub<Stay[]>(`/api/hotels/${HOTEL}/stays?from=${BD}&to=${BD}`);
  return {
    ...base!, id: "stay-voided", reference: "FH-VOID-1", guest: "Voided Twice",
    roomNumber: "VOID", arrival, departure, status: "void" as Stay["status"],
  };
}

beforeEach(() => {
  startSignedIn();
  extra = [];
  /* Every stays read answers what the demo has, and the voided booking too. */
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    const answer = await stub(path, init);
    return (path.split("?")[0]!.endsWith("/stays") ? [...(answer as Stay[]), ...extra] : answer) as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The Arrivals screen at `path`, with a cache of its own (the app's one
    cache would answer a second render from the first): its "N expected"
    once the list has loaded, and whether the voided booking is on it. */
async function arrivals(path: string): Promise<{ pill: string; voidShown: boolean }> {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/h/:code/arrivals" element={<ArrivalsPage />} />
          <Route path="/h/:code/arrivals/upcoming" element={<ArrivalsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const pill = (await screen.findByText(/^\d+ expected$/)).textContent!;
  const voidShown = screen.queryAllByText("Voided Twice").length > 0;
  cleanup();
  return { pill, voidShown };
}

describe("a voided booking (D27-326 (1))", () => {
  it("is not in today's arrivals, nor counted in them", async () => {
    const without = await arrivals(`/h/${HOTEL}/arrivals`);
    extra = [await voided(BD, "2026-08-27")];
    expect(await arrivals(`/h/${HOTEL}/arrivals`)).toEqual({ pill: without.pill, voidShown: false });
    expect((await listArrivals(HOTEL)).map((s) => s.id)).not.toContain("stay-voided");
  });

  it("is not in the upcoming arrivals, nor counted in them", async () => {
    const without = await arrivals(`/h/${HOTEL}/arrivals/upcoming`);
    extra = [await voided("2026-08-27", "2026-08-29")];
    expect(await arrivals(`/h/${HOTEL}/arrivals/upcoming`)).toEqual({ pill: without.pill, voidShown: false });
  });

  it("takes no room tonight and is not arriving in one (listVacant)", async () => {
    extra = [await voided(BD, "2026-08-27")];
    const { taken, arriving } = await listVacant(HOTEL);
    expect(taken.has("VOID")).toBe(false);
    expect(arriving.has("VOID")).toBe(false);
  });
});
