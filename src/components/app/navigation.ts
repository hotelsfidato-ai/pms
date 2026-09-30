import { CheckCircle2, Bell, MapPin, Palette, type LucideIcon } from "lucide-react";
import { canAccess, type Resource, type Role } from "@/lib/permissions";
import { decidesSomething } from "@/data/repositories/approvals";
/* Each service's own menu entries (docs/SERVICE-FOLDERS-PLAN.md). */
import { nav as frontDesk } from "@/modules/front-desk/nav";
import { nav as reservations } from "@/modules/reservations/nav";
import { nav as housekeeping } from "@/modules/housekeeping/nav";
import { nav as inventory } from "@/modules/inventory/nav";
import { nav as guests } from "@/modules/guests/nav";
import { nav as finance } from "@/modules/finance/nav";
import { nav as nightAudit } from "@/modules/night-audit/nav";
import { nav as pos } from "@/modules/pos/nav";
import { nav as banquet } from "@/modules/banquet/nav";
import { nav as stores } from "@/modules/stores/nav";
import { nav as reports } from "@/modules/reports/nav";
import { nav as admin } from "@/modules/admin/nav";
import { nav as channelManager } from "@/modules/channel-manager/nav";
/* The services not built yet: each an explanation page, in the section it
   will belong to, marked "Not built yet" (D27-87, 28 September). */
import { nav as accounting } from "@/modules/accounting/nav";
import { nav as bookingEngine } from "@/modules/booking-engine/nav";
import { nav as crm } from "@/modules/crm/nav";
import { nav as contracts } from "@/modules/contracts/nav";
import { nav as crs } from "@/modules/crs/nav";
import { nav as guestMessaging } from "@/modules/guest-messaging/nav";
import { nav as guestServices } from "@/modules/guest-services/nav";
import { nav as equipment } from "@/modules/equipment/nav";
import { nav as purchasing } from "@/modules/purchasing/nav";
import { nav as roomSystems } from "@/modules/room-systems/nav";
import { nav as laundry } from "@/modules/laundry/nav";
import { nav as leads } from "@/modules/leads/nav";
import { nav as loyalty } from "@/modules/loyalty/nav";
import { nav as marketing } from "@/modules/marketing/nav";
import { nav as onlineCheckin } from "@/modules/online-checkin/nav";
import { nav as payments } from "@/modules/payments/nav";
import { nav as revenueManagement } from "@/modules/revenue-management/nav";
import { nav as reputation } from "@/modules/reputation/nav";
import { nav as spa } from "@/modules/spa/nav";

/* ══════════════════════════════════════════════════════════════════
   PMS NAVIGATION
   Declared once, filtered by role. The tree is the PMS tree —
   CRS navigation is not reused. The chrome is the brand; the tree is not.
   ══════════════════════════════════════════════════════════════════ */

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** What this entry is about. Names the refusal when access is denied. */
  resource: Resource;
  /** Matches child routes too, e.g. /stay-view */
  matchPrefix?: boolean;
  children?: NavItem[];
  /**
   * Overrides the default "any grant on `resource`" visibility test.
   */
  canSee?: (role: Role) => boolean;
  /** Hidden outside a development build, whatever the role. */
  devOnly?: boolean;
  /**
   * `false` keeps the entry OUT OF THE SIDEBAR while it stays reachable —
   * by "Find a screen" and by its address — for anybody allowed to open
   * it. The owner's rule, 15 September: a shorter menu, nothing lost.
   */
  listed?: false;
  /**
   * Other words people type for this screen — the old name, the trade
   * word, what a guest would say. "Find a screen" matches them, so the
   * glossary's retired words still land somewhere (the clarity plan).
   */
  keywords?: string[];
  /**
   * The roles whose WORKING MENU this entry is in (the clarity plan, step 3).
   * Declared beside the entry by the service that owns it; `sidebarFor`
   * reads the lists assembled below. Absent means nobody's working menu —
   * the roles without one still see it in the full menu.
   */
  workingMenus?: readonly Role[];
  /** A service not built yet: its entry opens the page saying what it will
      do, and the menu and Find a screen mark it "Not built yet" (D27-87). */
  notBuilt?: true;
}

/** True in `vite dev` and in the test runner, false in a production build. */
export const IS_DEV = import.meta.env.DEV;

/** Whether the given role should see this entry at all.
 *
 *  `devOnly` is checked FIRST and is not a permission. A screen that can
 *  create tenants should not be reachable in production because somebody
 *  happens to hold the right role — it should not be there at all. The
 *  route is gated separately in App.tsx, because hiding a link has never
 *  been access control. */
const visible = (role: Role, item: NavItem): boolean => {
  if (item.devOnly && !IS_DEV) return false;
  return item.canSee ? item.canSee(role) : canAccess(role, item.resource);
};


/**
 * Whether a role may REACH a path — the same question the sidebar asks
 * about whether to show its link.
 *
 * ONE predicate, deliberately. The route guard first asked
 * `canAccess(role, resource)` while the sidebar asked whatever the item
 * said, and /admin/properties overrides that with a stricter
 * `can(role, "create", "hotel")` — put there when a read grant leaked
 * that page to the front desk. So the link was hidden and the page was
 * reachable: the exact disagreement a guard exists to remove,
 * reintroduced by the guard.
 *
 * Unknown paths return TRUE. This answers "does the navigation forbid
 * this", and a path the navigation has never heard of — a stay view, a
 * printed invoice — is not forbidden by it.
 */
export function mayReach(role: Role, path: string): boolean {
  for (const section of SECTIONS) {
    for (const item of section.items) {
      for (const entry of [item, ...(item.children ?? [])]) {
        if (entry.to === path) return visible(role, entry);
      }
    }
  }
  return true;
}

export interface NavSection {
  /** ⚠ CARRIED THROUGH SINCE 19 SEPTEMBER, when sections became
      foldable. The layout used to strip it and the sidebar had only the
      LABEL to go on — and a label is a word the owner may reword any
      afternoon, which would silently un-fold whatever it named and lose
      whatever a person had folded. The key does not change. */
  key?: string;
  /** When set, the section is hidden at properties without this module. */
  module?: string;
  /** Hidden from RECEPTION at a property where this module is off (087):
      the owner's per-hotel "Reception can use the POS" switch. Every
      other role is unaffected. The server refuses as well — this only
      stops offering a door that would be refused. */
  receptionNeeds?: string;
  label?: string;
  items: NavItem[];
}

/* ══════════════════════════════════════════════════════════════════
   ASSEMBLED FROM THE SERVICES (docs/SERVICE-FOLDERS-PLAN.md, 15 September)

   Each service declares its own entries in `src/modules/<service>/nav.ts`:
   the section an entry sits in, its place there, and which roles work
   from it. This file lays out the sections and fills them — so a service
   adding a screen never edits a file another agent is editing. The menu
   is the one the owner chose, entry for entry; `navigation.test.ts` pins
   every role's list.

   PMS tree. Where each person STARTS is theirs now (087): the GM sets it
   and they can change it — Dashboard, Rooms or Calendar.

   ⚠ 14 SEPTEMBER, THE OWNER'S CALL: "Group" is called Dashboard, and
   Rooms and Calendar are two entries, not one "Stay View" with a toggle.
   The Reservations section also carried a "Calendar" child pointing at
   that same Stay View — which opened on Rooms, so the menu's Calendar
   did not show a calendar. It is gone; Calendar is here, once.
   ══════════════════════════════════════════════════════════════════ */

export type SectionKey =
  | "home" | "front-desk" | "bookings" | "guests-crm" | "sales-marketing"
  | "across-properties" | "configuration" | "inventory" | "distribution"
  | "store-and-equipment" | "finance" | "point-of-sale" | "banquet"
  | "laundry" | "spa"
  | "reports" | "system";

/** A menu entry as a service declares it. */
export interface ServiceNavEntry extends NavItem {
  section: SectionKey;
  /** Its place in the section. Tens, so a new entry fits between two. */
  order: number;
}

const SECTION_LAYOUT: Array<Omit<NavSection, "items"> & { key: SectionKey }> = [
  { key: "home" },
  { key: "front-desk", label: "Front desk" },
  { key: "bookings", label: "Bookings" },
  /* GUESTS & CRM — the owner, 21 September (asked with a recommendation).
     Everything the system knows about a PERSON rather than a booking, in one
     place: the guest list, companies and agents, what was sent to them, the
     reviews asked for. The CRM's own screens join it as they are built
     (docs/briefs/crm.md: matching, the blacklist, Guest 360), and "Central
     CRM" left Coming soon the same day, because its home is now here.
     No screen gained or lost a permission; four entries changed section. */
  { key: "guests-crm", label: "Guests & CRM" },
  /* ══════════════════════════════════════════════════════════════
     NO "COMING SOON" SECTION — the owner, 28 September (D27-87)

     From 16 September every service not built yet sat in one section at
     the foot of the menu. Now each sits where it will belong, marked "Not
     built yet" (`notBuilt`): the channel manager, the booking engine, the
     CRS and contracts under Distribution; leads, marketing and loyalty
     under Sales and marketing; guest services in the Front desk, online
     payments in Finance, room systems in System. Who sees them is
     unchanged: the owner, admins and GMs (`seesComingSoon`), and
     marketing's own grant. A section holding only these is absent for
     everybody else. The pages behind them are the same explanation pages
     (`src/pages/ComingSoon.tsx`). An entry loses the mark the day its
     service is built.

     Sales and marketing sits beside Guests & CRM: both are about people.
     Distribution sits beside Rooms and rates: it sells those rooms. */
  { key: "sales-marketing", label: "Sales and marketing" },
  /* ══════════════════════════════════════════════════════════════
     WHAT BELONGS TO THE GROUP, AND WHAT BELONGS TO ONE HOTEL

     ⚠ THESE WERE ONE SECTION CALLED "INVENTORY" AND IT MIXED THE TWO.
     Properties and People sit above every hotel; room types and rate
     plans belong to the one you are looking at. Filed together, nothing
     told you which the property switcher would change — and People is
     not inventory by any reading.

     Raised by the owner on 8 September, having used it: "the people
     thing is only in the inventory section, and it is also about adding
     properties".

     Three sections now, and the split is the point:

       GROUP          above every hotel. The switcher does not touch it.
       CONFIGURATION  how THIS hotel is set up. Changes with the switcher.
       INVENTORY      what THIS hotel is selling today.

     The `/h/:code/` prefix already encodes this and nobody reads URLs
     to find out what a screen is scoped to. ══════════════════════ */
  /* ⚠ NOT "Group". The first nav item is already called Group — it is
     the group dashboard — and two things under that name in one
     sidebar is exactly the confusion this split exists to remove.
     "Across properties" says the scope out loud, which is the whole
     point: the property switcher does not touch anything in here. */
  { key: "across-properties", label: "Across properties" },
  /* "PROPERTY SETUP" (the owner, D27-196, 30 September): Settings ›
     Configuration is the hotel-wide settings page, and two places in one
     sidebar may not share a name. The key stays `configuration`. */
  { key: "configuration", label: "Property setup" },
  /* "ROOMS AND RATES", NOT "INVENTORY" — the owner, 16 September (S1). Since
     the Store and Equipment were planned, "inventory" meant two things: rooms
     and prices here, and stock on shelves. The key stays `inventory` because
     every service's nav.ts names it; only the words a person reads change. */
  { key: "inventory", label: "Rooms and rates" },
  { key: "distribution", label: "Distribution" },
  /* Stock and durable things — the Store now, Equipment and Purchasing when
     they are built (docs/STOCK-AND-EQUIPMENT-PLAN.md). */
  { key: "store-and-equipment", label: "Store and equipment" },
  { key: "finance", label: "Finance" },
  /* POINT OF SALE IS ITS OWN CATEGORY.

     These three lived under Finance, on the reasoning that a POS
     argument is about money on a folio. That was true when the only
     POS screen was a read-only view of what an outside till had sent.

     It stopped being true when the till itself was built. Taking an
     order, pricing a menu and settling a bill are a restaurant's work,
     done by restaurant staff on a restaurant's terminal — not the
     front office's. Burying them under Finance made a waiter scroll
     past folios and the city ledger to reach the till.

     Not every property has a restaurant. A section a hotel does not have
     is not greyed out with a reason — a clerk cannot act on "your hotel
     has no kitchen", so showing it is noise. It is simply absent.

     The API refuses these routes independently, so this is the tidy half
     of the feature and not the enforcement. A hidden nav entry is still
     a URL anybody can type. */
  { key: "point-of-sale", label: "Point of sale", module: "pos", receptionNeeds: "reception_pos" },
  /* Absent, not greyed, at a property with no hall — the same rule the
     point of sale follows. A clerk cannot act on "your hotel has no
     banquet hall", so showing it disabled is noise.

     And this is the tidy half only. The API refuses these routes on
     its own, because a hidden nav entry is still a URL anybody can
     type. 041 wrote that rule before either module existed. */
  { key: "banquet", label: "Banquet", module: "banquet" },
  /* ⚠ THE TWO SERVICES OF D17-54, EACH BEHIND ITS OWN PER-HOTEL SWITCH.

     Written by the master on 18 September because BOTH chats stopped here
     rather than editing this file, which is the agreement working: each had
     a service finished on the server and no screen at all, because
     `SectionKey` is a typed union — an entry naming a section that does not
     exist does not compile — and because `module:` sits on the SECTION. That
     is the only place a whole service hides at a property that has not
     switched it on, which is exactly what D17-54 asks for.

     Absent, not greyed, where the switch is off — the rule the point of sale
     and the banquet already follow. And the tidy half only: the API asks
     `app.module_enabled` on every route of its own, because a hidden nav
     entry is still a URL anybody can type. */
  { key: "laundry", label: "Laundry", module: "laundry" },
  { key: "spa", label: "Spa", module: "spa" },
  { key: "reports", label: "Reports" },
  { key: "system", label: "System" },
];

/* The entries that belong to no service: where the system talks to a
   person, the places and suppliers three services share, and the
   developers' component showcase. */
const CORE_ENTRIES: ServiceNavEntry[] = [
  /* Places and suppliers (16 September) — the Store, the equipment register
     and purchasing all read them, none owns them. Shown to anybody who can
     see stock or equipment; who may CHANGE them is the server's
     (api/src/routes/places.ts). No working menu: found through the section
     and Find a screen, so no role's pinned menu moved. */
  { section: "store-and-equipment", order: 30,
    label: "Places and suppliers", to: "/h/:code/places", icon: MapPin, resource: "stock",
    canSee: (role) => canAccess(role, "stock") || canAccess(role, "equipment"),
    keywords: ["location", "store", "kitchen store", "bar store", "supplier", "vendor", "gstin"] },
  { section: "system", order: 10,
    workingMenus: ["front_desk", "pos", "chef", "kitchen_manager", "housekeeping", "stores"],
    label: "Notifications", to: "/notifications", icon: Bell, resource: "notification", matchPrefix: true },
  /* ⚠ ONE PLACE TO SEE EVERYTHING WAITING ON YOU — the owner's D18-19.
     CORE, not a service's: the engine (076) spans every service, and
     equipment and purchasing each decide inside their own screen. A GM
     with four things waiting had to know to open four screens.

     `resource: "notification"` deliberately — it is the same idea, the
     roles who need it already hold it, and NO NEW RESOURCE was invented,
     because who may see a screen is the owner's to widen and not mine.
     `canSee` narrows the MENU to the roles that can decide anything at
     all, so a till operator is not offered an inbox that is empty by
     construction; the server still decides every row. */
  { section: "system", order: 5,
    label: "Approvals", to: "/h/:code/approvals", icon: CheckCircle2,
    resource: "notification", canSee: decidesSomething,
    /* ⚠ IN NOBODY'S WORKING MENU, deliberately. The Inventory Manager
       decides equipment gate passes, so it was in theirs — and
       `navigation.test.ts` refused it, correctly: that test pins every
       role's shortened menu entry for entry, because the owner chose
       those lists themselves on 15 September. Widening one is the
       owner's call, not a side effect of adding a screen.

       Nothing is lost. It sits in the SYSTEM section for every role that
       can decide anything, and "Find a screen" answers to approve,
       waiting, inbox, gate pass and sign off. */
    keywords: ["approve", "approval", "waiting", "inbox", "purchase request", "gate pass", "sign off"] },
  /* devOnly, like the admin console. It is a component showcase —
     developer documentation, not a screen anybody at a hotel has a
     reason to open, and it carries its own sample guest names into
     the bundle. */
  { section: "system", order: 30,
    label: "Design system", to: "/design-system", icon: Palette,
    resource: "dashboard", devOnly: true },
];

const ENTRIES: readonly ServiceNavEntry[] = [
  ...CORE_ENTRIES, ...frontDesk, ...reservations, ...housekeeping, ...inventory, ...guests,
  ...finance, ...nightAudit, ...pos, ...banquet, ...stores, ...reports, ...admin, ...channelManager,
  ...accounting, ...bookingEngine, ...crm, ...contracts, ...crs, ...guestMessaging, ...guestServices, ...equipment, ...purchasing, ...roomSystems, ...laundry, ...leads, ...loyalty, ...marketing, ...onlineCheckin, ...payments, ...revenueManagement, ...reputation, ...spa,
];

/** Every entry in a section, in its declared order. */
const entriesIn = (key: SectionKey): ServiceNavEntry[] =>
  ENTRIES.filter((entry) => entry.section === key).sort((a, b) => a.order - b.order);

/** The entry as the menu shows it: the service's bookkeeping taken off. */
function asItem(entry: NavItem): NavItem {
  const item: NavItem & Partial<Pick<ServiceNavEntry, "section" | "order">> = { ...entry };
  delete item.section;
  delete item.order;
  delete item.workingMenus;
  if (item.children) item.children = item.children.map(asItem);
  return item;
}

const SECTIONS: NavSection[] = SECTION_LAYOUT.map(({ key, ...section }) => ({
  ...section,
  key,
  items: entriesIn(key).map(asItem),
}));

/** Every declared entry and where it asked to sit — for the tests that
    refuse an entry the menu would silently drop. */
export const declaredEntries = (): ReadonlyArray<{ section: string; order: number; to: string }> =>
  ENTRIES.map(({ section, order, to }) => ({ section, order, to }));

export const sectionKeys = (): readonly string[] => SECTION_LAYOUT.map((s) => s.key);

/**
 * The navigation's own declaration for a path, unfiltered.
 *
 * `flatNavigationFor` answers "may this role see it", which depends on
 * `import.meta.env.DEV` among other things — and inside a test runner that
 * is always true. So a test that only checks the filtered output cannot
 * tell a `devOnly` entry from an ordinary one. This exposes the entry
 * itself so the flag can be asserted directly.
 */
export function navItemFor(path: string): NavItem | undefined {
  /* Recursive, because items nest — the whole /admin group sits inside
     one parent entry, and a one-level scan finds nothing there while
     `flatNavigationFor` happily returns it. That mismatch is how the
     first version of this returned undefined for a path the sidebar was
     visibly rendering. */
  const find = (items: NavItem[]): NavItem | undefined => {
    for (const item of items) {
      if (item.to === path) return item;
      const inChildren = find(item.children ?? []);
      if (inChildren) return inChildren;
    }
    return undefined;
  };

  for (const section of SECTIONS) {
    const found = find(section.items);
    if (found) return found;
  }
  return undefined;
}

/** Sections and items the given role can actually reach. */
/** Substitutes the property into any `/h/:code/...` path. */
function resolve(path: string, code: string): string {
  return path.replace(":code", code);
}

export function navigationFor(
  role: Role, code = "", modules?: Record<string, boolean>,
): NavSection[] {
  return SECTIONS
    /* `undefined` means not loaded yet, and a section is kept while the
       answer is unknown. Hiding it first and showing it a moment later
       makes the sidebar jump under somebody's cursor, which is worse than
       briefly offering a link the API will refuse with a reason. */
    .filter((section) =>
      !section.module || modules === undefined || modules[section.module] !== false)
    /* Reception, at a hotel whose GM has not let reception use the POS.
       `=== false` for the same reason as above: unknown keeps it. */
    .filter((section) =>
      !section.receptionNeeds || role !== "front_desk"
      || modules?.[section.receptionNeeds] !== false)
    .map((section) => ({
    ...section,
    items: section.items
      .map((item) => ({
        ...item,
        to: resolve(item.to, code),
        children: item.children
          ?.filter((child) => visible(role, child))
          .map((child) => ({ ...child, to: resolve(child.to, code) })),
      }))
      .filter((item) => visible(role, item) || (item.children?.length ?? 0) > 0),
  })).filter((section) => section.items.length > 0);
}

/** Flat list of every reachable route — feeds "Find a screen".
 *
 *  EVERYTHING the role may open, listed in the sidebar or not. This is the
 *  half of the owner's rule that keeps a shorter menu from losing anything:
 *  a screen off somebody's menu is still one search away. */
export function flatNavigationFor(
  role: Role, code = "", modules?: Record<string, boolean>,
): NavItem[] {
  const out: NavItem[] = [];
  for (const section of navigationFor(role, code, modules)) {
    for (const item of section.items) {
      if (visible(role, item)) out.push(item);
      for (const child of item.children ?? []) {
        if (!out.some((existing) => existing.to === child.to)) out.push(child);
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   THE MENU EACH PERSON WORKS FROM — the clarity plan, step 3

   The sidebar used to hide only what a role was FORBIDDEN, so everybody
   saw nearly everything they were allowed: reception 47 entries in the
   live build, housekeeping 28. A new receptionist faced a wall and asked.

   The owner's decisions, 15 September:
     · reception      — the core eight, plus All bookings and the cashier
                        drawer, plus the restaurant's screens when
                        "Reception can use the POS" is on
     · waiter (pos)   — Tables, Till, Terminal, Close restaurant day
     · chef           — Kitchen
     · kitchen mgr    — Kitchen, Menu, Close restaurant day
     · housekeeping   — Housekeeping, Work orders, Store
     · stores         — Store
     · no Dashboard for housekeeping, kitchen and stores: it carries
       revenue, and their day starts at their own work
     · everything else a role may open stays reachable by "Find a screen"
       (flatNavigationFor). Nothing here changes a permission.
     · 22 September: Rooms for housekeeping and the Store for the kitchen
       manager (D22-19); laundry's Dockets for reception and housekeeping
       where the hotel has laundry on (D22-22).

   Roles NOT listed — owner, admin, gm, hotel_manager, finance, read_only
   — keep every section they may open, minus what is unlisted for
   everybody (`listed: false`).

   Notifications rides along wherever the role may read it: it is where
   the system talks to a person, not a place they work.
   ══════════════════════════════════════════════════════════════════ */

/* Assembled from the entries' own `workingMenus`, in menu order — so the
   first entry is where a role without the Dashboard lands
   (`workingHomeFor`). The lists the owner chose are pinned in
   `navigation.test.ts`. */
const WORKING_MENUS: Partial<Record<Role, readonly string[]>> = (() => {
  const out: Partial<Record<Role, string[]>> = {};
  const add = (item: NavItem) => {
    for (const role of item.workingMenus ?? []) (out[role] ??= []).push(item.to);
  };
  for (const { key } of SECTION_LAYOUT) {
    for (const entry of entriesIn(key)) {
      add(entry);
      for (const child of entry.children ?? []) add(child);
    }
  }
  return out;
})();

/** The sidebar: what this person WORKS from, in the navigation's order. */
export function sidebarFor(
  role: Role, code = "", modules?: Record<string, boolean>,
): NavSection[] {
  const working = WORKING_MENUS[role];
  const keep = (item: NavItem) =>
    item.listed !== false
    && (!working || working.some((path) => resolve(path, code) === item.to));

  return navigationFor(role, code, modules)
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => ({ ...item, children: item.children?.filter(keep) }))
        .filter((item) => keep(item) || (item.children?.length ?? 0) > 0),
    }))
    .filter((section) => section.items.length > 0);
}

/* D22-19 put Rooms above housekeeping's own work and the Store above the
   kitchen's. It added them to the menus; it did not move where either
   starts, so both still land on their own work (15 September). */
const WORKING_HOME: Partial<Record<Role, string>> = {
  housekeeping: "/h/:code/housekeeping",
  kitchen_manager: "/h/:code/kitchen",
  /* Guest requests joined their menus in the Front desk section, above the
     restaurant's (D27-181); they still land on their own work (GS-1). */
  chef: "/h/:code/kitchen",
  pos: "/h/:code/floor",
};

/**
 * Where a person with a working menu lands when their first screen would
 * be the Dashboard they no longer have: the top of their own list.
 * Null for a role without one — they keep the ordinary first screen.
 */
export function workingHomeFor(role: Role, code: string): string | null {
  const working = WORKING_MENUS[role];
  if (!working || working.includes("/")) return null;
  return resolve(WORKING_HOME[role] ?? working[0]!, code);
}
