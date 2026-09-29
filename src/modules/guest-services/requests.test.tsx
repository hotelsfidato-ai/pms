import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import RequestsPage from "@/modules/guest-services/pages/Requests";

/* Guest requests (D27-181): Done closes housekeeping and food and drink in
   one tap; something broken asks what was done first. */

const LIST = "/api/hotels/5EL/requests?view=open";
const request = (id: string, team: string, what: string) => ({
  id, team, what, room: "101", guest: null, when: null, status: "open", fromGuest: true,
  raisedBy: null, raisedAt: "2026-09-30T10:00:00Z", takenBy: null, closedAt: null,
  resolution: null, minutes: 12,
});

function mount() {
  const spy = vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url === LIST) {
      return { teams: ["housekeeping", "maintenance", "fnb"], rooms: [],
               requests: [request("r1", "housekeeping", "Two towels"), request("r2", "maintenance", "Tap drips")] } as never;
    }
    return { ok: true } as never;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/h/5EL/requests"]}>
        <Routes><Route path="/h/:code/requests" element={<RequestsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>);
  return spy;
}

const patches = (spy: ReturnType<typeof mount>) =>
  spy.mock.calls.filter((c) => c[1]?.method === "PATCH").map((c) => [c[0], c[1]!.body]);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Guest requests", () => {
  it("closes housekeeping's in one tap, and asks what was done on something broken", async () => {
    const spy = mount();
    const towels = (await screen.findByText("Two towels")).closest("[data-request]") as HTMLElement;
    fireEvent.click(within(towels).getByRole("button", { name: /Done/ }));
    await waitFor(() => expect(patches(spy)).toEqual(
      [["/api/hotels/5EL/requests/r1", JSON.stringify({ action: "done" })]]));

    const tap = screen.getByText("Tap drips").closest("[data-request]") as HTMLElement;
    fireEvent.click(within(tap).getByRole("button", { name: /Done/ }));
    expect(await screen.findByText("What was done")).toBeTruthy();
    expect(patches(spy)).toHaveLength(1);
  });
});
