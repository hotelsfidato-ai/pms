import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { mayReach, flatNavigationFor } from "@/components/app/navigation";
import { ASSIGNABLE_ROLES, RATE_SETTER_ROLES } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import { nav } from "@/modules/inventory/nav";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";

const menuName = (to: string) => nav.find((e) => e.to === to)!.label;

/* Inventory and rates: who reaches the screens that SET a price. The
   entries are this service's (`nav.ts`, `routes.tsx`); the menu and the
   guard that read them are the core's. The server's half of the same
   rule is `api/test/modules/inventory/rateSetters.test.ts`. */

beforeEach(startSignedIn);

/* ══════════════════════════════════════════════════════════════════
   THE RATE CALENDAR — INV-5, approved by the owner on 16 September

   It writes prices, and it was open to everybody holding `rate: READ`:
   reception, the hotel manager, the viewer. Pricing was closed the same
   day with RATE_SETTER_ROLES; the Rate calendar had neither a `canSee`
   nor a route guard. Now both screens ask the one list.

   A hidden menu entry is not a closed door (PEO-1), so the page is
   rendered as well: the refusal has to be on the screen, not only
   missing from the sidebar.
   ══════════════════════════════════════════════════════════════════ */

describe("the screens that set a price", () => {
  it("are reached by exactly the roles in RATE_SETTER_ROLES", () => {
    for (const role of ASSIGNABLE_ROLES) {
      const may = RATE_SETTER_ROLES.includes(role);
      expect(mayReach(role, "/h/:code/grids"), `${role} and the Rate calendar`).toBe(may);
      expect(mayReach(role, "/h/:code/pricing"), `${role} and Pricing`).toBe(may);

      /* The menu and search agree with the guard. */
      const paths = flatNavigationFor(role, HOTEL).map((i) => i.to);
      expect(paths.includes(`/h/${HOTEL}/grids`), `${role} finds the Rate calendar`).toBe(may);
    }
  });

  it("refuses the Rate calendar to a receptionist who types the address", async () => {
    go(`/h/${HOTEL}/grids`);
    signedIn();                         // the default identity is a clerk
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /not part of your role/i }),
      "the Rate calendar rendered for a front-desk clerk",
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: menuName("/h/:code/grids") })).toBeNull();
  });

  it("opens the Rate calendar for a general manager", async () => {
    go(`/h/${HOTEL}/grids`);
    signedIn({
      scope: {
        staffId: "33333333-3333-3333-3333-333333333333",
        email: "gm@fidato.in",
        fullName: "Agra Manager",
        isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role: "gm" }],
      },
    });
    render(<App />);

    /* The page's own heading, because "no refusal" is also true of a
       blank screen. It is the menu's name, "Rate calendar" (D25-28, INV-2). */
    expect(
      await screen.findByRole("heading", { level: 1, name: menuName("/h/:code/grids") }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /not part of your role/i })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE HEADING IS THE MENU NAME — INV-2 (D17-22, D25-27)

   Room types was headed "The house". It is read here against its own
   menu entry in each of the three states that draw a heading, so
   renaming either one without the other fails.
   ══════════════════════════════════════════════════════════════════ */

describe("Room types is headed with its menu name (INV-2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["loading", "Loading…", () => new Promise(() => {})],
    ["did not load", "This property did not load", () => Promise.reject(new Error("down"))],
    ["loaded", "Nothing is set up yet", () => Promise.resolve({
      frontDesk: { checkInTime: "14:00", checkOutTime: "11:00",
                   earlyCheckinCharge: null, lateCheckoutCharge: null },
      types: [], rooms: [],
    })],
  ])("%s", async (_state, shows, answer) => {
    /* Only the screen's own read answers; the cards inside it never do. */
    vi.spyOn(apiModule, "api").mockImplementation(((url: string) =>
      url.endsWith("/room-setup") ? answer() : new Promise(() => {})) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/h/${HOTEL}/room-types`]}>
          <Routes><Route path="/h/:code/room-types" element={<RoomSetupPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText(new RegExp(`^${shows}`));
    expect(screen.getByRole("heading", { level: 1 }).textContent)
      .toBe(menuName("/h/:code/room-types"));
  });
});
