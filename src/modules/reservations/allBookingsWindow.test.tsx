import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import { BUSINESS_DATE } from "@/data/repositories";
import { addDays } from "@/lib/format";
import ReservationsPage from "./pages/Reservations";

/* THE OWNER'S D27-387 (2 November, the load test): All bookings opens on the
   last 90 days and everything ahead, and a search still reaches every booking
   ever made. Every booking was 64 s and 3.7 MB at a hotel three years in. */

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("All bookings", () => {
  it("opens on the last 90 days, asks every booking when searched, and from the date chosen", async () => {
    startSignedIn();
    const asked: string[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
      if (path.includes("/stays")) asked.push(path);
      return path.includes("/stays") ? [] : new Promise(() => {});
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/h/5EL/reservations"]}>
            <Routes><Route path="/h/:code/reservations" element={<ReservationsPage />} /></Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(asked).toContain(`/api/hotels/5EL/stays?since=${addDays(BUSINESS_DATE, -90)}`));

    fireEvent.change(screen.getByLabelText("Search bookings"), { target: { value: "Joshi" } });
    await waitFor(() => expect(asked).toContain("/api/hotels/5EL/stays?q=joshi"));

    fireEvent.change(screen.getByLabelText("Search bookings"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Bookings leaving from"), { target: { value: "2025-01-01" } });
    await waitFor(() => expect(asked).toContain("/api/hotels/5EL/stays?since=2025-01-01"));
    expect(asked.some((u) => u.endsWith("/stays")), "every booking ever, unasked").toBe(false);
  });
});
