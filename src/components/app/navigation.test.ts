import { describe, expect, it } from "vitest";
import {
  navigationFor, sidebarFor, flatNavigationFor, workingHomeFor, type NavItem,
} from "./navigation";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THE MENU'S NAMING RULES, ENFORCED

   The clarity plan of 15 September found the menu speaking two ways at
   once: "City ledger" under Finance and "City Ledger" under Reports —
   two different screens — and "Night Audit" in the menu over a page
   headed "Night audit". Wording drifts one label at a time, and nobody
   reviewing a single change sees the whole menu. These tests do.
   ══════════════════════════════════════════════════════════════════ */

/** Every label the owner's menu can show — sections, items, children. */
function everyLabel(): string[] {
  const labels: string[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      labels.push(item.label);
      walk(item.children ?? []);
    }
  };
  for (const section of navigationFor("owner", "5EL")) {
    if (section.label) labels.push(section.label);
    walk(section.items);
  }
  return labels;
}

/* Words that keep their capitals wherever they fall: acronyms, and the
   names of statutory forms. Anything else capitalised after the first
   word is Title Case creeping back. */
const PROPER = new Set(["GST", "Form", "F", "C", "C-Form", "Fidato", "POS"]);

describe("the menu speaks one way", () => {
  it("writes every label in sentence case", () => {
    const offenders = everyLabel().filter((label) =>
      label
        .split(/[\s/]+/)
        .slice(1)
        .some((word) => /^[A-Z]/.test(word) && !PROPER.has(word)),
    );
    expect(offenders).toEqual([]);
  });

  it("never gives two places the same name", () => {
    /* Two screens both called "City ledger" is how a clerk ends up on
       the report when they wanted the accounts. A parent that opens the
       same page as its first child is allowed to share its name only
       if they are genuinely the same destination — none do today. */
    const seen = new Map<string, number>();
    for (const label of everyLabel()) {
      seen.set(label.toLowerCase(), (seen.get(label.toLowerCase()) ?? 0) + 1);
    }
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([label]) => label);
    expect(duplicates).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE MENU EACH PERSON WORKS FROM — the owner's lists, 15 September

   Pinned exactly, so a menu cannot quietly grow back into a wall — and
   paired with the other half of the rule: whatever leaves a menu is
   still one search away (`flatNavigationFor` feeds "Find a screen").
   ══════════════════════════════════════════════════════════════════ */

const ALL_ON = { pos: true, banquet: true, reception_pos: true };

/** What the sidebar lists for a role, parents and children, in order. */
function menu(role: Role, modules: Record<string, boolean> = ALL_ON): string[] {
  return sidebarFor(role, "5EL", modules).flatMap((section) =>
    section.items.flatMap((item) => [
      item.label,
      ...(item.children ?? []).filter((c) => c.to !== item.to).map((c) => c.label),
    ]),
  );
}

/** Every screen "Find a screen" offers the role. */
function searchable(role: Role): string[] {
  return flatNavigationFor(role, "5EL", ALL_ON).map((item) => item.label);
}

describe("each person's menu", () => {
  it("gives reception the core eight, bookings and the drawer — and the POS only when switched on", () => {
    const core = [
      "Dashboard", "Rooms", "Calendar",
      "Arrivals", "Upcoming", "In house", "Due out", "Walk-ins",
      "All bookings", "Guests", "New booking",
      "Cashiering",
    ];
    expect(menu("front_desk", { ...ALL_ON, reception_pos: false })).toEqual([...core, "Notifications"]);
    expect(menu("front_desk")).toEqual([
      ...core,
      "Tables", "Till", "Terminal", "Close restaurant day",
      "Notifications",
    ]);
  });

  it("still lets reception FIND what left its menu", () => {
    /* The owner's condition for a shorter menu: nothing lost. */
    const found = searchable("front_desk");
    for (const screen of ["Rate plans", "Night audit", "Lodging tax", "Housekeeping", "Groups"]) {
      expect(found).toContain(screen);
    }
    expect(menu("front_desk")).not.toContain("Rate plans");
  });

  it("gives the restaurant and the kitchen their own screens", () => {
    expect(menu("pos")).toEqual(["Tables", "Till", "Terminal", "Close restaurant day"]);
    expect(menu("chef")).toEqual(["Kitchen", "Notifications"]);
    expect(menu("kitchen_manager")).toEqual(["Kitchen", "Menu", "Close restaurant day", "Notifications"]);
  });

  it("gives housekeeping and the stores their work — and no revenue Dashboard", () => {
    expect(menu("housekeeping")).toEqual(["Housekeeping", "Work orders", "Store", "Notifications"]);
    expect(menu("stores")).toEqual(["Store", "Notifications"]);
    for (const role of ["housekeeping", "stores", "chef", "kitchen_manager", "pos"] as Role[]) {
      expect(menu(role)).not.toContain("Dashboard");
    }
  });

  it("lands them on their own work instead of the Dashboard", () => {
    expect(workingHomeFor("housekeeping", "5EL")).toBe("/h/5EL/housekeeping");
    expect(workingHomeFor("chef", "5EL")).toBe("/h/5EL/kitchen");
    expect(workingHomeFor("front_desk", "5EL")).toBeNull();
    expect(workingHomeFor("owner", "5EL")).toBeNull();
  });

  it("lists three reports for everybody and keeps the rest a search away", () => {
    const reports = sidebarFor("owner", "5EL", ALL_ON).find((s) => s.label === "Reports");
    expect(reports?.items.map((i) => i.label)).toEqual(["Night audit", "All reports", "Manager report"]);
    expect(searchable("owner")).toContain("Lodging tax");
  });

  it("lists the channel manager for nobody — it is not connected", () => {
    for (const role of ["owner", "gm", "front_desk"] as Role[]) {
      expect(menu(role)).not.toContain("Channel manager");
    }
    expect(searchable("owner")).toContain("Channel manager");
  });
});
