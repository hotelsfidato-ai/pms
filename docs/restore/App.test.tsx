import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "./App";
import { useUi } from "@/lib/ui";
import { navigationFor, flatNavigationFor } from "@/components/app/navigation";

/* ══════════════════════════════════════════════════════════════════
   Routing per PHASE-1-FRONTEND §1.2:
     /                group dashboard
     /h/:code/stay    the tape chart
   The property is in the URL, not only in a store.
   ══════════════════════════════════════════════════════════════════ */

const HOTEL = "5-elements-akkalkot";
const go = (path: string) => window.history.pushState({}, "", path);

beforeEach(() => {
  go("/");
  useUi.setState({ role: "front_desk", hotelId: HOTEL, sidebarCollapsed: false });
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
