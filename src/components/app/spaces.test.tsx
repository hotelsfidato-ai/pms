import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import App from "@/App";
import { flatNavigationFor, mayReach, sidebarFor, spaceOf, spacesFor } from "./navigation";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THREE SPACES, ONE SIGN-IN (D27-249, D27-256)

   Front office, Restaurant (/pos/:code/...) and the Settings console
   (/settings/<group>/<slug>), each with its own menu. The owner, an Admin
   and the GM switch between all three; the hotel manager, reception (where
   "Reception can use the POS" is on), the accountant and a viewer between
   the first two; the waiter, the chef and the kitchen manager have the
   Restaurant only. No permission changes: who may open a screen is as it was.
   ══════════════════════════════════════════════════════════════════ */

const ALL_ON = { pos: true, banquet: true, reception_pos: true, laundry: true };
const labels = (role: Role, space: "front" | "pos" | "settings") =>
  sidebarFor(role, "5EL", ALL_ON, space).flatMap((s) => s.items.map((i) => i.label));

describe("who has which space", () => {
  it.each([
    ["owner", ["front", "pos", "settings"]],
    ["admin", ["front", "pos", "settings"]],
    ["gm", ["front", "pos", "settings"]],
    ["hotel_manager", ["front", "pos"]],
    ["front_desk", ["front", "pos"]],
    ["finance", ["front", "pos"]],
    ["read_only", ["front", "pos"]],
    ["pos", ["pos"]],
    ["chef", ["pos"]],
    ["kitchen_manager", ["pos"]],
    ["housekeeping", ["front"]],
    ["stores", ["front"]],
    ["revenue_manager", ["front"]],
  ] as const)("%s: %j", (role, spaces) => {
    expect(spacesFor(role, "5EL", ALL_ON)).toEqual(spaces);
  });

  it("gives reception the Restaurant only where the hotel lets reception use the POS", () => {
    expect(spacesFor("front_desk", "5EL", { ...ALL_ON, reception_pos: false })).toEqual(["front"]);
  });

  it("gives nobody a Restaurant at a hotel without one", () => {
    expect(spacesFor("owner", "5EL", { ...ALL_ON, pos: false })).toEqual(["front", "settings"]);
  });

  it("tells the space from the address", () => {
    expect(spaceOf("/settings")).toBe("settings");
    expect(spaceOf("/settings/rates/taxes")).toBe("settings");
    expect(spaceOf("/pos/5EL/tables")).toBe("pos");
    expect(spaceOf("/h/5EL/stay")).toBe("front");
    expect(spaceOf("/")).toBe("front");
  });
});

describe("each space's menu", () => {
  it("moves the restaurant's screens out of the Front office menu and into its own", () => {
    for (const gone of ["Tables", "Till", "Kitchen", "Charges to rooms", "Settings"]) {
      expect(labels("owner", "front"), gone).not.toContain(gone);
    }
    const pos = sidebarFor("owner", "5EL", ALL_ON, "pos").flatMap((s) => s.items);
    expect(pos.map((i) => i.label)).toEqual([
      "Tables", "Table bookings", "Till", "Terminal", "Kitchen", "Menu",
      "Close restaurant day", "Charges to rooms", "Restaurant setup",
    ]);
    expect(pos.filter((i) => !i.to.startsWith("/pos/5EL/")).map((i) => i.to)).toEqual([]);
    expect(labels("front_desk", "pos")).toEqual(["Tables", "Till", "Terminal", "Close restaurant day"]);
  });

  it("keeps the waiter's, chef's and kitchen manager's whole menu in their one space (Q3)", () => {
    expect(labels("pos", "pos")).toEqual(["Guest requests", "Tables", "Till", "Terminal", "Close restaurant day"]);
    expect(labels("kitchen_manager", "pos")).toEqual(
      ["Guest requests", "Store", "Kitchen", "Menu", "Close restaurant day", "Notifications"]);
  });

  it("groups the console as the plan does, and draws a group only when it holds something", () => {
    const owner = sidebarFor("owner", "5EL", ALL_ON, "settings");
    expect(owner.map((s) => s.label)).toEqual([
      "Property", "Rooms", "Rates and tax", "Money", "Lists", "Front desk", "Messages",
      "People and security", "Modules and connections",
    ]);
    const people = owner.find((s) => s.label === "People and security")!.items;
    expect(people.map((i) => i.label)).toEqual(
      ["People", "Roles and permissions", "Audit log", "Activity", "Sign-ins and devices", "Signing in"]);
    /* A link to a Front office screen is marked and keeps its address. */
    const roomTypes = owner.find((s) => s.label === "Rooms")!.items[0]!;
    expect(roomTypes).toMatchObject({ to: "/h/5EL/room-types", leaves: true });
    expect(owner.flatMap((s) => s.items).find((i) => i.label === "Taxes"))
      .toMatchObject({ to: "/settings/rates/taxes" });

    /* The GM: no module switches, no roles matrix, no sign-ins, integrations or system health. */
    const gm = labels("gm", "settings");
    for (const gone of ["Modules", "Roles and permissions", "Sign-ins", "Integrations", "System health"]) {
      expect(gm, gone).not.toContain(gone);
    }
    expect(gm).toContain("Taxes");
    expect(labels("owner", "settings")).toEqual(expect.arrayContaining(["Modules", "Integrations", "System health"]));
  });

  it("keeps every console page in Find a screen and behind the menu's own rule", () => {
    expect(flatNavigationFor("owner", "5EL", ALL_ON).map((i) => i.to)).toContain("/settings/rates/taxes");
    expect(mayReach("owner", "/settings/connections/modules")).toBe(true);
    expect(mayReach("gm", "/settings/connections/modules")).toBe(false);
    expect(mayReach("hotel_manager", "/settings/rates/taxes")).toBe(false);
    expect(mayReach("front_desk", "/pos/:code/tables")).toBe(true);
    expect(mayReach("housekeeping", "/pos/:code/tables")).toBe(false);
  });
});

describe("the addresses", () => {
  beforeEach(() => {
    startSignedIn();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const as = (role: Role | "group-admin") => signedIn({
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222", email: "someone@fidato.in", fullName: "Someone",
      isGroupAdmin: role === "group-admin",
      hotels: role === "group-admin" ? [] : [{ hotelId: AGRA_HOTEL, role }],
    },
  });
  const lands = async (from: string, to: string) => {
    go(from);
    render(<App />);
    await waitFor(() => expect(window.location.pathname + window.location.search, from).toBe(to));
    cleanup();
  };

  it.each([
    ["/h/5EL/floor", "/pos/5EL/tables"],
    ["/h/5EL/till", "/pos/5EL/till"],
    ["/h/5EL/till/terminal?outlet=1", "/pos/5EL/terminal?outlet=1"],
    ["/h/5EL/kitchen", "/pos/5EL/kitchen"],
    ["/h/5EL/menu", "/pos/5EL/menu"],
    ["/h/5EL/till/day-end", "/pos/5EL/day-end"],
    ["/h/5EL/table-bookings", "/pos/5EL/table-bookings"],
    ["/h/5EL/till/setup", "/pos/5EL/setup"],
    ["/h/5EL/till/bill/abc", "/pos/5EL/bill/abc"],
    ["/h/5EL/pos", "/pos/5EL/room-charges"],
  ])("sends the restaurant's old %s to %s", async (from, to) => {
    as("group-admin");
    await lands(from, to);
  });

  it.each([
    ["/settings", "/settings/property/profile"],
    ["/settings/property", "/settings/property/profile"],
    ["/settings/rates-and-taxes", "/settings/rates/taxes"],
    ["/settings/taxes-and-billing", "/settings/rates/taxes"],
    ["/settings/operations", "/settings/front-desk/times-and-rules"],
    ["/settings/people", "/settings/people/signing-in"],
    ["/settings/modules-and-connections", "/settings/connections/modules"],
    ["/admin/settings", "/settings/property/profile"],
    ["/admin/configuration", "/settings/rates/taxes"],
    ["/h/5EL/settings/taxes-and-billing", "/settings/rates/taxes"],
  ])("sends Settings' old %s to %s", async (from, to) => {
    as("group-admin");
    await lands(from, to);
  });

  it("opens a console page, and sends the GM from one they may not see to their first", async () => {
    as("group-admin");
    go("/settings/rates/taxes");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Taxes" })).toBeTruthy();
    cleanup();

    as("gm");
    await lands("/settings/connections/modules", "/settings/property/profile");
  });

  it("offers the switcher to whoever has two spaces, and not to the waiter", async () => {
    as("group-admin");
    go("/settings/rates/taxes");
    render(<App />);
    const spaces = await screen.findByRole("navigation", { name: "Spaces" });
    expect(within(spaces).getAllByRole("link").map((a) => a.textContent))
      .toEqual(["Front office", "Restaurant", "Settings"]);
    expect(within(spaces).getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    cleanup();

    as("pos");
    go("/pos/5EL/tables");
    render(<App />);
    await screen.findAllByRole("link", { name: /Tables/ });
    expect(screen.queryByRole("navigation", { name: "Spaces" })).toBeNull();
  });
});
