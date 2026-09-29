import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import LoyaltyPage from "@/modules/loyalty/pages/Loyalty";

/* THE LOYALTY SCREEN (D27-179). No earn rate is a sentence, never a zero
   (L8); a guest joins only with the tick (L4); a booking site's booking
   offers no points off it (L14). The rules themselves are the database's:
   db/tests/modules/loyalty.sql. */

const posted: Array<{ path: string; body: unknown }> = [];

function open() {
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    return {
      name: "Test Rewards", pointsPer100: null,
      words: "Join Test Rewards: we keep your stays and points to give you rewards. I am 18 or over.",
      maySetRules: false, isOn: true, isManager: false,
      stays: [
        { id: "s1", reference: "R-1", room: "101", guestId: "g1", name: "Asha Rao", hasPhone: true,
          member: false, points: null, direct: true },
        { id: "s2", reference: "R-2", room: "102", guestId: "g2", name: "Ota Guest", hasPhone: true,
          member: true, points: 900, direct: false },
      ],
    } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><LoyaltyPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Loyalty screen", () => {
  it("says stays earn nothing while no rate is set, and offers no points off a booking site's stay", async () => {
    open();
    expect(await screen.findByText(/no earn rate set: stays earn nothing/)).toBeDefined();
    expect(screen.getAllByText("Ota Guest").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Use points" })).toBeNull();
  });

  it("joins a guest only once the guest's yes is ticked", async () => {
    open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Join" }))[0]!);
    const join = await screen.findByRole("button", { name: "Join" });
    expect((join as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(join);
    await waitFor(() => expect(posted).toEqual([
      { path: "/api/hotels/5EL/loyalty/guests/g1/join", body: { agreed: true } }]));
  });
});
