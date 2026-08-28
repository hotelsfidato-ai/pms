import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "./App";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { navigationFor, flatNavigationFor } from "@/components/app/navigation";

/* ══════════════════════════════════════════════════════════════════
   Routing per PHASE-1-FRONTEND §1.2:
     /                group dashboard
     /h/:code/stay    the tape chart
   The property is in the URL, not only in a store.
   ══════════════════════════════════════════════════════════════════ */

/* CP9: the id a screen puts in a URL is the hotel CODE, because that is
   what Postgres calls it — `hotels.code`, commented "appears in URLs" in
   migration 002. It used to be the fixture's slug. Screens did not change;
   they take whatever the repository hands them. */
const HOTEL = "5EL";
const go = (path: string) => window.history.pushState({}, "", path);

/* CP8 put a session in front of the shell. These tests are about
   routing, not sign-in, so they seed a signed-in clerk directly. The
   guard itself is asserted in its own block below. */
const AGRA_HOTEL = "11111111-1111-1111-1111-111111111111";

const signedIn = (overrides: Partial<ReturnType<typeof useSession.getState>> = {}) =>
  useSession.setState({
    status: "signed-in",
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222",
      email: "agra@fidato.in",
      fullName: "Agra Clerk",
      isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "front_desk" }],
    },
    hotels: [
      {
        id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra",
        state: "UP", gstin: null, timezone: "Asia/Kolkata", currency: "INR",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    ],
    hotelId: AGRA_HOTEL,
    ...overrides,
  });

beforeEach(() => {
  go("/");
  useUi.setState({ hotelId: HOTEL, sidebarCollapsed: false });
  signedIn();
});

describe("group dashboard at /", () => {
  it("lists properties, not a clerk's working day", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /fidato hotels/i })).toBeDefined();
  });

  it("links each property into its own tape chart", async () => {
    render(<App />);
    const link = await screen.findByRole("link", { name: /5 Elements/i });
    expect(link.getAttribute("href")).toBe(`/h/${HOTEL}/stay`);
  });
});

describe("the tape chart at /h/:code/stay", () => {
  beforeEach(() => go(`/h/${HOTEL}/stay`));

  it("renders fourteen date columns", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-date-col]")).toHaveLength(14);
  });

  it("renders the seventeen sellable rooms, not the eighteen physical ones", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-room-row]")).toHaveLength(17);
  });

  it("draws booking bars from the demo data", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-booking-bar]").length).toBeGreaterThan(0);
  });

  it("offers every filter pill with a live count", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    const pills = [...container.querySelectorAll("[data-filter-pill]")].map((p) =>
      p.getAttribute("data-filter-pill"),
    );
    /* Arrivals earns its own pill: a check-in must visibly move a number,
       and it is the one that drops when a guest is checked in. */
    expect(pills).toEqual([
      "All", "Vacant", "Occupied", "Arrivals", "Reserved", "Blocked", "Due Out", "Dirty",
    ]);
  });

  it("opens the detail panel from a deep link, with the chart still behind it", async () => {
    go(`/h/${HOTEL}/stay?res=stay-overpaid`);
    const { container } = render(<App />);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Kalyani Rege")).toBeDefined();
    /* The clerk must not lose their place. */
    expect(container.querySelectorAll("[data-room-row]").length).toBe(17);
  });
});

describe("navigation is driven by the permission matrix", () => {
  it("gives an owner strictly more than a housekeeper", () => {
    expect(flatNavigationFor("owner", HOTEL).length).toBeGreaterThan(
      flatNavigationFor("housekeeping", HOTEL).length,
    );
  });

  it("keeps administration away from the front desk", () => {
    const paths = flatNavigationFor("front_desk", HOTEL).map((i) => i.to);
    expect(paths.some((p) => p.startsWith("/admin"))).toBe(false);
  });

  it("resolves :code into every property-scoped path", () => {
    const paths = flatNavigationFor("owner", HOTEL).map((i) => i.to);
    expect(paths.some((p) => p.includes(":code"))).toBe(false);
    expect(paths).toContain(`/h/${HOTEL}/stay`);
  });

  it("leads every role to the tape chart", () => {
    for (const role of ["owner", "manager", "front_desk", "housekeeping", "finance"] as const) {
      const paths = navigationFor(role, HOTEL).flatMap((s) => s.items.map((i) => i.to));
      expect(paths, `${role} cannot reach the tape chart`).toContain(`/h/${HOTEL}/stay`);
    }
  });
});


describe("the session guard", () => {
  it("sends a signed-out visitor to sign in, without flashing the shell", async () => {
    useSession.setState({ status: "signed-out", scope: null, hotels: [], hotelId: null });
    go("/h/" + HOTEL + "/stay");

    render(<App />);

    /* The sign-in screen, and no trace of the application shell. */
    expect(
      await screen.findByRole("heading", { name: /property management/i }),
    ).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the signed-in person and their role, not a role picker", async () => {
    render(<App />);

    /* The CP1 role switcher offered every role. Its replacement states
       one and offers none — a preview control beside a real session is
       how a clerk previews themselves as an owner. */
    const account = await screen.findByRole("button", { name: /agra clerk/i });
    expect(account.getAttribute("aria-label")).toContain("Front Desk");
    expect(screen.queryByRole("button", { name: /viewing as/i })).toBeNull();
  });
});
