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
const PROPER = new Set(["GST", "Form", "III", "Fidato", "POS", "CRS", "CRM", "WhatsApp"]);

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

const ALL_ON = { pos: true, banquet: true, reception_pos: true, laundry: true };

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
      /* Online check-in's desk screen, 21 September (the owner's D21-89):
         reception confirms a guest's details against the ID here. */
      "Online check-in",
      /* 30 September (the owner's D27-181): guests' in-stay requests. */
      "Guest requests",
      "All bookings",
      /* 29 September (the owner's D27-174): what the CRS sold, and the
         notes the desk acts on when it changes there. */
      "CRS bookings",
      "New booking",
      /* Guests & CRM, from 21 September (the owner): the same screen, its
         own section. */
      "Guests",
      /* 24 September (the owner): where a guest's message to the desk
         waits (D23-14). */
      "Guest messages",
      "Cashiering",
    ];
    /* Laundry's Dockets where the hotel has laundry on (D22-22). */
    expect(menu("front_desk", { ...ALL_ON, reception_pos: false }))
      .toEqual([...core, "Dockets", "Notifications"]);
    expect(menu("front_desk")).toEqual([
      ...core,
      "Tables", "Till", "Terminal", "Close restaurant day",
      "Dockets",
      "Notifications",
    ]);
  });

  it("puts laundry in the working menus only where the hotel has it on (D22-22)", () => {
    for (const role of ["front_desk", "housekeeping", "gm", "hotel_manager"] as const) {
      expect(menu(role), role).toContain("Dockets");
      expect(menu(role, { ...ALL_ON, laundry: false }), role).not.toContain("Dockets");
    }
  });

  it("offers the spa diary to exactly the server's six - not the accountant or a viewer (SPA-2)", () => {
    for (const role of ["owner", "admin", "gm", "hotel_manager", "front_desk", "housekeeping"] as const) {
      expect(mayReach(role, "/h/:code/spa"), role).toBe(true);
    }
    for (const role of ["finance", "read_only", "chef", "pos"] as const) {
      expect(mayReach(role, "/h/:code/spa"), role).toBe(false);
    }
  });

  it("gathers what the system knows about a person in Guests & CRM (21 September)", () => {
    const section = sidebarFor("gm", "5EL", ALL_ON).find((s) => s.label === "Guests & CRM");
    expect(section?.items.map((i) => i.label)).toEqual([
      "Guests", "Companies and agents", "Guest messages", "Reviews",
      /* The CRM's screens join it as they are built (D21-79): 21 September,
         for the owner, an administrator and the GM only (D21-4). */
      "Guest 360", "Possible same person",
    ]);
    const clerk = sidebarFor("front_desk", "5EL", ALL_ON).find((s) => s.label === "Guests & CRM");
    expect(clerk?.items.map((i) => i.label) ?? []).not.toContain("Guest 360");
    expect(mayReach("front_desk", "/crm/guests")).toBe(false);
    expect(mayReach("hotel_manager", "/crm/same-person")).toBe(false);
    expect(mayReach("admin", "/crm/guests")).toBe(true);
  });

  it("offers the check-in desk to exactly the server's DESK_ROLES (21 September)", () => {
    /* guestDoor.ts refuses everybody else; the accountant and a viewer hold
       the Guests grant, so a menu keyed on it would offer them a screen that
       refuses them (SPA-2). */
    for (const role of ["owner", "admin", "gm", "hotel_manager", "front_desk"] as const) {
      expect(mayReach(role, "/h/:code/online-checkin"), role).toBe(true);
    }
    for (const role of ["finance", "read_only", "housekeeping", "pos"] as const) {
      expect(mayReach(role, "/h/:code/online-checkin"), role).toBe(false);
    }
  });

  it("still lets reception FIND what left its menu", () => {
    /* The owner's condition for a shorter menu: nothing lost. */
    const found = searchable("front_desk");
    for (const screen of ["Rates", "Night audit", "Lodging tax", "Housekeeping", "Groups"]) {
      expect(found).toContain(screen);
    }
    expect(menu("front_desk")).not.toContain("Rates");
  });

  it("gives the restaurant and the kitchen their own screens", () => {
    /* Guest requests joined all three on 30 September (D27-181): food and
       drink is theirs. It sits in the Front desk section, so it comes first;
       where they land is unchanged (below). */
    expect(menu("pos")).toEqual(["Guest requests", "Tables", "Till", "Terminal", "Close restaurant day"]);
    expect(menu("chef")).toEqual(["Guest requests", "Kitchen", "Notifications"]);
    /* The Store joined the kitchen manager's on 22 September (D22-19). */
    expect(menu("kitchen_manager")).toEqual(
      ["Guest requests", "Store", "Kitchen", "Menu", "Close restaurant day", "Notifications"]);
  });

  it("keeps the revenue manager out of the restaurant's menu (D22-35)", () => {
    expect(mayReach("revenue_manager", "/h/:code/menu")).toBe(false);
    for (const role of ["owner", "admin", "gm", "kitchen_manager", "hotel_manager", "front_desk"] as const) {
      expect(mayReach(role, "/h/:code/menu"), role).toBe(true);
    }
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
    /* Rooms joined on 22 September (D22-19), laundry's Dockets where the
       hotel has it on (D22-22), and Purchasing once D22-11 let housekeeping
       see it (the owner, 24 September). */
    expect(menu("housekeeping")).toEqual(
      ["Rooms", "Housekeeping", "Work orders", "Guest requests", "Store", "Equipment", "Purchasing", "Dockets",
       "Notifications"]);
    expect(menu("stores")).toEqual(["Store", "Equipment", "Purchasing", "Notifications"]);
    for (const role of ["housekeeping", "stores", "chef", "kitchen_manager", "pos"] as Role[]) {
      expect(menu(role)).not.toContain("Dashboard");
    }
  });

  it("lands them on their own work instead of the Dashboard", () => {
    /* Still, with Rooms and the Store now above their own work (D22-19). */
    expect(workingHomeFor("housekeeping", "5EL")).toBe("/h/5EL/housekeeping");
    expect(workingHomeFor("kitchen_manager", "5EL")).toBe("/h/5EL/kitchen");
    expect(workingHomeFor("chef", "5EL")).toBe("/h/5EL/kitchen");
    /* The chef and the waiter still land on the Kitchen and Tables, with
       Guest requests above them in their menus (D27-181, GS-1: without
       WORKING_HOME naming them, both landed on Guest requests). */
    expect(workingHomeFor("pos", "5EL")).toBe("/h/5EL/floor");
    expect(workingHomeFor("front_desk", "5EL")).toBeNull();
    expect(workingHomeFor("owner", "5EL")).toBeNull();
  });

  it("lists three reports for everybody and keeps the rest a search away", () => {
    const reports = sidebarFor("owner", "5EL", ALL_ON).find((s) => s.label === "Reports");
    expect(reports?.items.map((i) => i.label)).toEqual(["Night audit", "All reports", "Manager report"]);
    expect(searchable("owner")).toContain("Lodging tax");
  });

  it("puts each service not built yet in its own section, marked - for the owner, admins and GMs only", () => {
    /* ⚠ NO COMING SOON SECTION SINCE 28 SEPTEMBER (the owner, D27-87). Each
       service not built yet sits where it will belong, marked "Not built
       yet": Distribution beside Rooms and rates, Sales and marketing beside
       Guests & CRM, and one each at the foot of the Front desk, Finance and
       System. The history below is the Coming soon list's, from the owner's
       decision of 16 September (one section at the foot of the menu). */
    /* 16 September, the stock-and-equipment plan: "Hotel equipment" became
       "Equipment" (the register), its door-lock content moved to "Room
       systems", and "Purchasing" arrived. Each takes its alphabetical place.

       ⚠ AND "PURCHASING" LEFT AGAIN, 18 September — it is BUILT (phase 2C),
       so its entry moved into "Store and equipment" beside the Store and the
       Equipment register. A service that is built cannot also be coming soon;
       this list shrinks by one every time one of them lands, as it did when
       Equipment left it. Edited by the purchasing chat; the master reviews it
       at merge.

       ⚠ AND "REVIEWS" LEFT, 19 September — it is BUILT (D18-14), so its entry
       moved into "Front desk" on the Guests permission, which is the owner's
       answer of the same day. Edited by the reviews chat, which owns no file
       in this folder; the master reviews it at merge, exactly as it did the
       line above. Laundry and Spa left in the same hour, by the master's own
       merge of their screens — this chat rebased onto that and took both
       sides rather than handing over a conflict. Nothing else here was
       touched.

       ⚠ AND "ACCOUNTING EXPORT" LEFT, 19 September - the Tally export is
       BUILT (D18-16), so its entry moved into "Reports", beside the figures
       it is made of. The same rule, one service later. Edited by the
       accounting chat; the master reviews it at merge.

       ⚠ AND "GUEST MESSAGES" LEFT, 19 September — it is BUILT (BUILD-PLAN § 4),
       so its entry moved into "Bookings": what was sent to a guest is part of
       their booking, and that is where somebody goes looking for it. Edited by
       the guest-messaging chat, the same way and for the same reason as
       purchasing; the master reviews it at merge. */
    /* ⚠ AND "CENTRAL CRM" LEFT, 21 September — the owner gave it a home:
       the "Guests & CRM" section, which its screens join as they are built. */
    /* ⚠ AND "FIDATO CRS" LEFT, 29 September - the CRS bridge is BUILT
       (D27-168, D27-171), so its entry moved into "Bookings" as "CRS
       bookings", as Guest messages did. Edited by the CRS lane; the master
       reviews it at merge. */
    /* ⚠ AND "GUEST SERVICES" LEFT, 30 September - it is BUILT as Guest
       requests (D27-178, D27-181), a working screen in the Front desk. */
    const NOT_BUILT: Record<string, string[]> = {
      /* 29 September: Leads and WhatsApp and Marketing are BUILT (D27-168,
         D27-170); their entries stay in this section as working screens. */
      "Sales and marketing": ["Loyalty"],
      /* 30 September: the channel manager is BUILT (D27-178); it stays in
         Distribution as a working screen. */
      "Distribution": ["Booking engine", "Contracts"],
      "Finance": ["Online payments"],
      "System": ["Room systems"],
    };
    for (const role of COMING_SOON_ROLES) {
      const sections = sidebarFor(role, "5EL", ALL_ON);
      const labels = sections.map((s) => s.label);
      expect(labels, role).not.toContain("Coming soon");
      expect(labels.indexOf("Sales and marketing"), role).toBe(labels.indexOf("Guests & CRM") + 1);
      expect(labels.indexOf("Distribution"), role).toBe(labels.indexOf("Rooms and rates") + 1);
      const marked = Object.fromEntries(sections
        .map((s) => [s.label, s.items.filter((i) => i.notBuilt).map((i) => i.label)] as const)
        .filter(([, items]) => items.length > 0));
      expect(marked, role).toEqual(NOT_BUILT);
    }
    const all = Object.values(NOT_BUILT).flat();
    for (const role of ROLES.filter((r) => !COMING_SOON_ROLES.includes(r))) {
      const labels = navigationFor(role, "5EL", ALL_ON).map((s) => s.label);
      /* Sales and marketing now holds Leads and WhatsApp for everyone who sees
         guests (D27-170); its not-built entries stay hidden, below. */
      expect(labels, role).not.toContain("Distribution");
      for (const label of all) expect(searchable(role), `${role} finds ${label}`).not.toContain(label);
    }
  });

  it("refuses a page of a service not built yet to exactly the people the menu hides it from", () => {
    /* ⚠ THIS USED /coming-soon/spa AND HAD TO MOVE, 19 September. The spa
       and the laundry were built, so their Coming soon pages are gone —
       and `mayReach` answers TRUE for a path the navigation has never
       heard of, deliberately (a stay view, a printed invoice). So an
       assertion naming a DELETED path does not test a refusal at all; it
       passes for the opposite reason and would go on passing for ever.

       Named a page that is still Coming soon instead. When room systems
       is built, this line moves again — and that is the point: it is only
       ever a real check while the page it names still exists. */
    expect(mayReach("gm", "/coming-soon/room-systems")).toBe(true);
    expect(mayReach("front_desk", "/coming-soon/room-systems")).toBe(false);
    expect(mayReach("hotel_manager", "/coming-soon/loyalty")).toBe(false);
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
