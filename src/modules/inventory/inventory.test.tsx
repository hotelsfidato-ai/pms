import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { mayReach, flatNavigationFor } from "@/components/app/navigation";
import { ASSIGNABLE_ROLES, RATE_SETTER_ROLES } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";

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
    expect(screen.queryByRole("heading", { name: /inventory and rates/i })).toBeNull();
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
       blank screen. */
    expect(
      await screen.findByRole("heading", { name: /inventory and rates/i }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /not part of your role/i })).toBeNull();
  });
});
