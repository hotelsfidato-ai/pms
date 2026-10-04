import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { mayReach, flatNavigationFor } from "@/components/app/navigation";
import { ASSIGNABLE_ROLES, canAccess } from "@/lib/permissions";
import { HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import { nav } from "@/modules/inventory/nav";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";
import { settingsPages } from "@/modules/inventory/rooms.settings";

const menuName = (to: string) => nav.find((e) => e.to === to)!.label;

/* Inventory and rates: who reaches the one Rates screen (D27-188,
   D27-194). Everyone who reads a price sees it; only the rate setters
   change one - the screen asks setsRates (freeTick.test.tsx) and the
   server asks the gate (api/test/roleGate.test.ts, rateSetters.test.ts). */

beforeEach(startSignedIn);

describe("the Rates screen (D27-188, D27-194)", () => {
  it("is reached by every role that reads a price, and only those", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(mayReach(role, "/h/:code/rates"), role).toBe(canAccess(role, "rate"));
      /* The menu and search agree with the guard. */
      const paths = flatNavigationFor(role, HOTEL).map((i) => i.to);
      expect(paths.includes(`/h/${HOTEL}/rates`), `${role} finds Rates`)
        .toBe(canAccess(role, "rate"));
    }
  });

  it.each(["grids", "pricing", "rate-plans"])(
    "opens from the old address /%s, headed with its menu name", async (old) => {
      go(`/h/${HOTEL}/${old}`);
      signedIn();                         // a front-desk clerk: rate READ
      render(<App />);
      expect(await screen.findByRole("heading", { level: 1, name: menuName("/h/:code/rates") }))
        .toBeDefined();
      cleanup();
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
      /* Since D27-258 its name is the settings console's (rooms.settings.ts). */
      .toBe(settingsPages.find((p) => p.slug === "room-types")!.label);
  });
});
