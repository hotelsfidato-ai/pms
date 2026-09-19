import { describe, expect, it } from "vitest";
import {
  navigationFor, sidebarFor, flatNavigationFor, workingHomeFor, type NavItem,
  declaredEntries, sectionKeys, mayReach,
} from "./navigation";
import { ROLES, COMING_SOON_ROLES, type Role } from "@/lib/permissions";

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
const PROPER = new Set(["GST", "Form", "F", "C", "C-Form", "Fidato", "POS", "CRS", "CRM", "WhatsApp"]);

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

  it("keeps every label short enough for the sidebar", () => {
    /* The sidebar is 248px and cuts a long label with an ellipsis. On
       16 September "Contracts and allotments" (24 characters) showed as
       "Contracts and allotm…" — found by opening the screen, not by a
       test. The longest label that fits is 21 characters today. */
    expect(everyLabel().filter((label) => label.length > 21)).toEqual([]);
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
  it("gives reception the core eight, bookings and the drawer - and the POS only when switched on", () => {
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

  it("gives housekeeping and the stores their work - and no revenue Dashboard", () => {
    /* Equipment joined on 16 September — the owner's answer to the equipment chat.
       Purchasing joined the Inventory Manager's on 18 September, when it was
       built: they are the first name on D18-2's default list of who may raise a
       request, so without the entry the one person the service is for could
       reach their own screen only by searching. Housekeeping does NOT get it —
       they are switched on by the owner if the owner wants them, and until then
       the entry would be a screen that refuses them. Flagged to the owner by the
       purchasing chat; the master reviews it at merge. */
    expect(menu("housekeeping")).toEqual(["Housekeeping", "Work orders", "Store", "Equipment", "Notifications"]);
    expect(menu("stores")).toEqual(["Store", "Equipment", "Purchasing", "Notifications"]);
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

  it("lists every service not built yet under Coming soon - for the owner, admins and GMs only", () => {
    /* The owner's decision, 16 September: one section at the foot of the
       menu, every service the system does not have yet, alphabetical. */
    /* 16 September, the stock-and-equipment plan: "Hotel equipment" became
       "Equipment" (the register), its door-lock content moved to "Room
       systems", and "Purchasing" arrived. Each takes its alphabetical place.

       ⚠ AND "PURCHASING" LEFT AGAIN, 18 September — it is BUILT (phase 2C),
       so its entry moved into "Store and equipment" beside the Store and the
       Equipment register. A service that is built cannot also be coming soon;
       this list shrinks by one every time one of them lands, as it did when
       Equipment left it. Edited by the purchasing chat; the master reviews it
       at merge.

       ⚠ AND "ACCOUNTING EXPORT" LEFT, 19 September - the Tally export is
       BUILT (D18-16), so its entry moved into "Reports", beside the figures
       it is made of. The same rule, one service later. Edited by the
       accounting chat; the master reviews it at merge. */
    const SOON = [
      "Booking engine", "Central CRM", "Channel manager",
      "Contracts", "Fidato CRS", "Guest messages", "Guest services",
      "Laundry", "Leads and WhatsApp", "Loyalty", "Marketing", "Online check-in",
      "Online payments", "Reviews",
      "Room systems", "Spa",
    ];
    for (const role of COMING_SOON_ROLES) {
      const sections = sidebarFor(role, "5EL", ALL_ON);
      const last = sections[sections.length - 1];
      expect(last?.label, `${role}: the section sits at the foot`).toBe("Coming soon");
      expect(last?.items.map((i) => i.label)).toEqual(SOON);
    }
    for (const role of ROLES.filter((r) => !COMING_SOON_ROLES.includes(r))) {
      expect(navigationFor(role, "5EL", ALL_ON).some((s) => s.label === "Coming soon"), role).toBe(false);
      for (const label of SOON) expect(searchable(role), `${role} finds ${label}`).not.toContain(label);
    }
  });

  it("refuses a Coming soon page to exactly the people the menu hides it from", () => {
    expect(mayReach("gm", "/coming-soon/spa")).toBe(true);
    expect(mayReach("front_desk", "/coming-soon/spa")).toBe(false);
    expect(mayReach("hotel_manager", "/coming-soon/leads")).toBe(false);
    expect(mayReach("owner", "/h/:code/channels")).toBe(true);
    expect(mayReach("front_desk", "/h/:code/channels")).toBe(false);
  });
});

/* The menu is assembled from each service's own entries (the service-folder
   move, 15 September). Two ways that can go wrong without an error: an entry
   naming a section that does not exist simply never appears, and two entries
   claiming one place sort by accident. */
describe("the menu assembled from the services", () => {
  it("puts every entry in a section that exists", () => {
    const known = new Set(sectionKeys());
    expect(declaredEntries().filter((e) => !known.has(e.section)).map((e) => e.to)).toEqual([]);
  });

  it("gives no two entries the same place in a section", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of declaredEntries()) {
      const place = `${e.section} #${e.order}`;
      const other = seen.get(place);
      if (other) clashes.push(`${place}: ${other} and ${e.to}`);
      seen.set(place, e.to);
    }
    expect(clashes).toEqual([]);
  });
});
