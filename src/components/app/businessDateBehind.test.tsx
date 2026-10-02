import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, go, signedIn } from "@/test/app";
import { useUi } from "@/lib/ui";
import { TooltipProvider } from "@/components/ui";
import { TopBar } from "./TopBar";

/* THE OWNER'S D27-237 (2 October): while a property's business date is behind
   its real date (the server's, in the hotel's time zone), every screen's top
   bar says so in one line. Hidden when it is not behind. */

const agra = (dates: { businessDate: string; today: string }) => signedIn({
  hotels: [{
    id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra", state: "UP", gstin: null,
    timezone: "Asia/Kolkata", currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", ...dates,
  }],
});

const bar = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider><MemoryRouter><TopBar /></MemoryRouter></TooltipProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  go("/");
  useUi.setState({ hotelId: AGRA_HOTEL });
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the top bar's business date line", () => {
  it("says how far the business date is behind today, and where to close the days", () => {
    agra({ businessDate: "2026-09-11", today: "2026-10-02" });
    bar();
    expect(screen.getByRole("status").textContent)
      .toBe("Business date 11 Sep, 21 days behind today (2 Oct). Close the days in Night audit.");
  });

  it("is not there when the business date is today", () => {
    agra({ businessDate: "2026-10-02", today: "2026-10-02" });
    bar();
    expect(document.querySelector("[data-business-date-behind]")).toBeNull();
  });
});
