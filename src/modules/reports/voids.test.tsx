import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import ReportsIndexPage from "@/modules/reports/pages/Index";
import { mayReach } from "@/components/app/navigation";
import { ROLES, can, type Role } from "@/lib/permissions";
import { AGRA_HOTEL, startSignedIn, signedIn, withDemoHotel } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE VOIDS REPORT IN THE REPORTS LIST (the owner's D27-370)

   Offered to exactly those who hold `report` view - the people the server
   lets read it (roleGate: the night audit report's rule, which prints the
   same voids). Nobody else is offered it, and the address is closed to them.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => { startSignedIn(); withDemoHotel(); });

const as = (role: Role) => signedIn({
  scope: {
    staffId: "22222222-2222-2222-2222-222222222222", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

const renderIndex = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ReportsIndexPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe("the Voids report", () => {
  it("is reachable by exactly the roles that hold `report`", () => {
    const readers = ROLES.filter((r) => mayReach(r, "/reports/voids"));
    expect(readers).toEqual(ROLES.filter((r) => can(r, "view", "report")));
    expect(readers).toEqual(
      ["owner", "admin", "gm", "hotel_manager", "revenue_manager", "front_desk", "finance", "read_only"]
        .filter((r) => (ROLES as readonly string[]).includes(r)));
    for (const waiter of ["pos", "bar", "kitchen_manager", "chef"] as Role[]) {
      expect(mayReach(waiter, "/reports/voids"), waiter).toBe(false);
    }
  });

  it("shows in All reports for the GM, with what it holds", async () => {
    as("gm");
    renderIndex();
    expect(await screen.findByText("Voids")).toBeDefined();
    expect(screen.getByText(/Every voided bill, order closed unpaid and struck dish/)).toBeDefined();
    cleanup();
  });

  it("does not show in All reports for a role without `report`", async () => {
    as("hotel_manager");
    renderIndex();
    expect(await screen.findByText("Voids")).toBeDefined();
    cleanup();
    as("pos");
    renderIndex();
    expect(await screen.findByText("No report matches that")).toBeDefined();
    expect(screen.queryByText("Voids")).toBeNull();
  });
});
