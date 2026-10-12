import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import LoyaltyPage from "@/modules/loyalty/pages/Loyalty";

/* THE LOYALTY SCREEN (D27-179). No earn rate is a sentence, never a zero
   (L8); a guest joins only with the tick (L4); a booking site's booking
   offers no points off it (L14). The rules themselves are the database's:
   db/tests/modules/loyalty.sql. */

const posted: Array<{ path: string; body: unknown }> = [];

const MEMBER = { id: "s3", reference: "R-3", room: "103", guestId: "g3", name: "Direct Member",
  hasPhone: true, member: true, points: 900, direct: true };

function open(over: Record<string, unknown> = {}) {
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    return {
      name: "Test Rewards", pointsPer100: null,
      words: "Join Test Rewards: we keep your stays and points to give you rewards. I am 18 or over.",
      maySetRules: false, isOn: true, isManager: false, mayRedeem: true,
      stays: [
        { id: "s1", reference: "R-1", room: "101", guestId: "g1", name: "Asha Rao", hasPhone: true,
          member: false, points: null, direct: true },
        { id: "s2", reference: "R-2", room: "102", guestId: "g2", name: "Ota Guest", hasPhone: true,
          member: true, points: 900, direct: false },
      ],
      ...over,
    } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><LoyaltyPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/* Reception, who may join, leave and use points, unless a test says otherwise. */
beforeEach(() => { signedIn(); });
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

  it("offers Use points only to whoever holds the right, and tells the rest who does (D27-305)", async () => {
    open({ stays: [MEMBER] });
    expect((await screen.findAllByRole("button", { name: "Use points" })).length).toBeGreaterThan(0);
    cleanup(); vi.restoreAllMocks();

    open({ stays: [MEMBER], mayRedeem: false });
    expect(await screen.findByText(
      "Points are used by reception, the hotel manager, the general manager, an administrator or the owner.")).toBeDefined();
    expect(screen.getAllByText("Direct Member").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Use points" })).toBeNull();
  });

  /* D27-307 (4): the server refuses them Join and Leave (roleGate
     LOYALTY_MEMBER, `customer` edit), so the screen does not offer them. */
  it.each(["finance", "read_only"] as const)("offers %s no Join or Leave, and says who does (D27-307)", async (role) => {
    signedIn({ scope: {
      staffId: "44444444-4444-4444-4444-444444444444", email: "x@fidato.in",
      fullName: "Test", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
    } });
    open({ mayRedeem: false });
    expect(await screen.findByText(
      /Guests join and leave through reception, the hotel manager, the general manager, an administrator or the owner\./)).toBeDefined();
    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
  });
});
