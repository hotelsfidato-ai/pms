import {
  LayoutDashboard, CalendarCheck, Users, Building2, Hotel, Receipt,
  BarChart3, Bell, Settings, ShieldCheck, CalendarRange,
  FileText, Wallet, Plug, ScrollText,
  UserCog, Palette, Terminal, MonitorSmartphone, BookOpen, Home, ClipboardList, type LucideIcon, ShieldAlert, Globe, Package, UtensilsCrossed, Flame, LayoutGrid, Banknote, Table2, BookPlus, Wrench, PartyPopper,
} from "lucide-react";
import { can, canAccess, type Resource, type Role } from "@/lib/permissions";

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
}

/** True in `vite dev` and in the test runner, false in a production build. */
export const IS_DEV = import.meta.env.DEV;

/** Whether the given role should see this entry at all.
 *
 *  `devOnly` is checked FIRST and is not a permission. A screen that can
 *  create tenants should not be reachable in production because somebody
 *  happens to hold the right role — it should not be there at all. The
 *  route is gated separately in App.tsx, because hiding a link has never
 * 
 * this is the the sercer sectiosa nda needs to hold complina de and i need ot 
 * this she shnnot need sto do some bull shite 
 * 
 * awd
 * 
 * jtosm
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

/* PMS tree. Where each person STARTS is theirs now (087): the GM sets it
   and they can change it — Dashboard, Rooms or Calendar.

   ⚠ 14 SEPTEMBER, THE OWNER'S CALL: "Group" is called Dashboard, and
   Rooms and Calendar are two entries, not one "Stay View" with a toggle.
   The Reservations section also carried a "Calendar" child pointing at
   that same Stay View — which opened on Rooms, so the menu's Calendar
   did not show a calendar. It is gone; Calendar is here, once. */
const SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard, resource: "dashboard" },
      { label: "Rooms", to: "/h/:code/stay", icon: Home, resource: "dashboard" },
      { label: "Calendar", to: "/h/:code/calendar", icon: CalendarRange, resource: "reservation" },
    ],
  },
  {
    label: "Front desk",
    items: [
      {
        label: "Arrivals", to: "/h/:code/arrivals", icon: CalendarCheck,
        resource: "reservation", matchPrefix: true,
        children: [
          { label: "Today", to: "/h/:code/arrivals", icon: CalendarCheck, resource: "reservation" },
          { label: "Upcoming", to: "/h/:code/arrivals/upcoming", icon: CalendarRange, resource: "reservation" },
        ],
      },
      {
        label: "In house", to: "/h/:code/in-house", icon: Users,
        resource: "reservation", matchPrefix: true,
        children: [
          { label: "In house now", to: "/h/:code/in-house", icon: Users, resource: "reservation" },
          { label: "Due out", to: "/h/:code/in-house/due-out", icon: CalendarRange, resource: "reservation" },
        ],
      },
      { label: "Walk-ins", to: "/h/:code/walk-ins", icon: BookOpen, resource: "reservation" },
      { label: "Housekeeping", to: "/h/:code/housekeeping", icon: ClipboardList, resource: "inventory" },
      /* Beside housekeeping, because that is who finds most of it — and
         separate from a room block, because most work orders take no room
         out of service. */
      { label: "Work orders", to: "/h/:code/work-orders", icon: Wrench, resource: "room_config" },
    ],
  },
  {
    label: "Bookings",
    items: [
      {
        label: "All bookings", to: "/h/:code/reservations", icon: CalendarCheck,
        resource: "reservation", matchPrefix: true,
      },
      { label: "Guests", to: "/guests", icon: Users, resource: "customer", matchPrefix: true },
      /* A wedding is one conversation and nine rooms. Every other list
         here shows those nine as nine unrelated bookings, so the person
         taking the call had to hold the relationship in their head. */
      { label: "Groups", to: "/h/:code/groups", icon: Users, resource: "reservation", matchPrefix: true },
      /* ⚠ THIS SAID "BOOKING SOURCES" AND THERE ARE NOW TWO OF THOSE.
         It was renamed from "Companies" for a good reason at the time —
         somebody looking for their OTA performance read "Companies" and
         went past it, because no screen answered that question. One does
         now, under Configuration, and two identical labels meaning two
         different things is worse than the problem the rename solved.

         "Companies and agents" is what the rows actually are, and it is
         the same vocabulary as the booking form's Business source field.
         Found by auditing the navigation against itself on 9 September;
         I introduced the collision the day before and did not look. */
      { label: "Companies and agents", to: "/companies", icon: Building2, resource: "company", matchPrefix: true },
      /* One guest, one set of nights, several rooms — and a group made
         for them automatically when there is more than one. */
      { label: "New booking", to: "/h/:code/book", icon: BookPlus, resource: "reservation" },
    ],
  },
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
  {
    /* ⚠ NOT "Group". The first nav item is already called Group — it is
       the group dashboard — and two things under that name in one
       sidebar is exactly the confusion this split exists to remove.
       "Across properties" says the scope out loud, which is the whole
       point: the property switcher does not touch anything in here. */
    label: "Across properties",
    items: [
      { label: "Properties", to: "/properties", icon: Hotel, resource: "hotel", matchPrefix: true },
      { label: "People", to: "/people", icon: UserCog, resource: "user", matchPrefix: true },
    ],
  },
  {
    label: "Configuration",
    items: [
      { label: "Room types", to: "/h/:code/room-types", icon: LayoutDashboard, resource: "room_config" },
      { label: "Rate plans", to: "/h/:code/rate-plans", icon: Wallet, resource: "rate" },
      { label: "Cancellation terms", to: "/h/:code/cancellation-terms", icon: ShieldAlert, resource: "rate" },
      /* `commission` rather than `rate`: the list is where a booking
         came from and the screen is where its commission is agreed.
         A clerk does not see it — they pick from the list on the
         booking form, which is not gated here. */
      { label: "Booking sources", to: "/h/:code/booking-sources", icon: Plug, resource: "commission" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Rate calendar", to: "/h/:code/grids", icon: Table2, resource: "rate" },
      { label: "Rate performance", to: "/h/:code/rates", icon: BarChart3, resource: "rate" },
      { label: "Channel manager", to: "/h/:code/channels", icon: Globe, resource: "rate" },
      { label: "Store", to: "/h/:code/stores", icon: Package, resource: "inventory", matchPrefix: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Folios", to: "/h/:code/folios", icon: Receipt, resource: "invoice", matchPrefix: true },
      { label: "Invoices", to: "/h/:code/invoices", icon: FileText, resource: "invoice", matchPrefix: true },
      { label: "Payments", to: "/h/:code/payments", icon: Wallet, resource: "payment" },
      /* The drawer somebody is holding right now. Beside the folios and
         payments it reconciles against, not under reports — a report is
         read afterwards, this is used during the shift. */
      { label: "Cashiering", to: "/h/:code/cashiering", icon: Wallet, resource: "payment" },
      { label: "Company accounts", to: "/h/:code/city-ledger", icon: Building2, resource: "commission" },
      /* Form C is a COMPLIANCE obligation about guests, not a finance
         document — but it is filed by the same person who bills, at the
         same desk, and burying it under Reports is how a 24-hour
         deadline gets missed. It sits where somebody will see it. */
      { label: "Form C", to: "/h/:code/form-c", icon: ShieldAlert, resource: "customer" },
    ],
  },
  {
    /* POINT OF SALE IS ITS OWN CATEGORY.

       These three lived under Finance, on the reasoning that a POS
       argument is about money on a folio. That was true when the only
       POS screen was a read-only view of what an outside till had sent.

       It stopped being true when the till itself was built. Taking an
       order, pricing a menu and settling a bill are a restaurant's work,
       done by restaurant staff on a restaurant's terminal — not the
       front office's. Burying them under Finance made a waiter scroll
       past folios and the city ledger to reach the till. */
    label: "Point of sale",
    /* Not every property has a restaurant. A section a hotel does not have
       is not greyed out with a reason — a clerk cannot act on "your hotel
       has no kitchen", so showing it is noise. It is simply absent.

       The API refuses these routes independently, so this is the tidy half
       of the feature and not the enforcement. A hidden nav entry is still
       a URL anybody can type. */
    module: "pos",
    receptionNeeds: "reception_pos",
    items: [
      /* The FLOOR first, because that is where a shift starts: a waiter
         walks to a table before there is a bill to stand at. */
      { label: "Floor", to: "/h/:code/floor", icon: LayoutGrid, resource: "payment" },
      /* The till, the one somebody stands at. */
      { label: "Till", to: "/h/:code/till", icon: Receipt, resource: "payment" },
      /* A dedicated screen for a fixed terminal: no sidebar, no chrome,
         one outlet, targets sized for a thumb rather than a mouse. */
      {
        label: "Terminal", to: "/h/:code/till/terminal",
        icon: MonitorSmartphone, resource: "payment",
      },
      /* The pass. A wall screen in the kitchen, behind the same
         permission as the till — the people who cook and the people who
         ring up are the same restaurant. */
      { label: "Kitchen", to: "/h/:code/kitchen", icon: Flame, resource: "payment" },
      /* The prices, which are the hotel's. Behind the same permission as
         rates, because setting what a dish costs is the same kind of act
         as setting what a room costs. */
      { label: "Menu", to: "/h/:code/menu", icon: UtensilsCrossed, resource: "rate" },
      /* Where the shift ends. Last, because it is — and beside the
         till rather than under Finance, for the same reason the till
         is here: a cashier counting a drawer at midnight is doing
         restaurant work, not the front office's. */
      {
        label: "Close restaurant day", to: "/h/:code/till/day-end",
        icon: Banknote, resource: "payment",
      },
      /* What an OUTSIDE till sent and what was refused. Read-only, and
         named so nobody mistakes it for the till above. */
      { label: "Charges to rooms", to: "/h/:code/pos", icon: Plug, resource: "invoice" },
    ],
  },
  {
    label: "Banquet",
    /* Absent, not greyed, at a property with no hall — the same rule the
       point of sale follows. A clerk cannot act on "your hotel has no
       banquet hall", so showing it disabled is noise.

       And this is the tidy half only. The API refuses these routes on
       its own, because a hidden nav entry is still a URL anybody can
       type. 041 wrote that rule before either module existed. */
    module: "banquet",
    items: [
      /* The diary first, because the question is almost always "is the
         hall free" and only then "what is booked". */
      { label: "Diary", to: "/h/:code/banquet", icon: PartyPopper, resource: "reservation" },
      { label: "Halls and packages", to: "/h/:code/banquet/setup", icon: Building2, resource: "room_config" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Night audit", to: "/h/:code/night-audit", icon: BarChart3, resource: "report" },
      /* The index first — it is the taxonomy, and the seven below are
         the shortcuts a manager pins for themselves. */
      { label: "All reports", to: "/reports", icon: FileText, resource: "report" },
      { label: "Manager report", to: "/reports/manager", icon: BarChart3, resource: "report" },
      { label: "City ledger", to: "/reports/city-ledger", icon: Building2, resource: "report" },
      { label: "No show", to: "/reports/no-show", icon: CalendarCheck, resource: "report" },
      { label: "Monthly occupancy", to: "/reports/monthly-occupancy", icon: BarChart3, resource: "report" },
      { label: "Monthly statistics", to: "/reports/monthly-stats", icon: BarChart3, resource: "report" },
      { label: "Yearly statistics", to: "/reports/yearly-stats", icon: BarChart3, resource: "report" },
      { label: "Lodging tax", to: "/reports/lodging-tax", icon: FileText, resource: "report" },
      /* FOUR THAT WERE BUILT AND NOT LISTED. The index says "11 of 11
         built" and this menu offered seven — so the GST Sales Register,
         the one an accountant needs every month to file GSTR-1, was
         reachable only by somebody who thought to open All reports
         first and read down it.

         A screen that exists and cannot be found from the navigation is
         a screen that does not exist to the person looking for it. */
      { label: "GST sales register", to: "/reports/gst-sales", icon: ScrollText, resource: "report" },
      { label: "Form F / C-Form", to: "/reports/c-form", icon: ShieldCheck, resource: "report" },
      { label: "Guest ledger", to: "/reports/guest-ledger", icon: BookOpen, resource: "report" },
      { label: "Cashier shift", to: "/reports/cashier-shift", icon: Banknote, resource: "report" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Notifications", to: "/notifications", icon: Bell, resource: "notification", matchPrefix: true },
      {
        label: "Administration", to: "/admin/users", icon: Settings,
        resource: "user", matchPrefix: true,
        children: [
          /* ⚠ "PROPERTIES" WAS HERE TOO, POINTING AT /admin/properties.
             The two screens were merged on 9 September — /properties now
             adds, edits, closes and reopens, and /admin/properties
             renders it — so this was a second door onto one room, and
             the sidebar said "Properties" twice.

             The reasoning it carried is still true and now lives in the
             screen: everyone may READ the property list, and creating
             one is gated by `app.require_provisioning_key()` in the
             database, which no menu entry can grant or withhold. */
          { label: "Users", to: "/admin/users", icon: UserCog, resource: "user" },
          { label: "Roles and permissions", to: "/admin/roles", icon: ShieldCheck, resource: "role" },
          { label: "Integrations", to: "/admin/integrations", icon: Plug, resource: "integration" },
          { label: "Audit log", to: "/admin/audit-log", icon: ScrollText, resource: "audit_log" },
          { label: "Settings", to: "/admin/settings", icon: Settings, resource: "setting" },
          /* The console CREATES things — properties, people, access. It is
             the only screen in the system that manufactures a tenant, so it
             stays out of production builds until the group says otherwise. */
          {
            label: "Console", to: "/admin/console", icon: Terminal,
            resource: "hotel", devOnly: true,
            canSee: (role) => can(role, "create", "hotel"),
          },
        ],
      },
      /* devOnly, like the admin console. It is a component showcase —
         developer documentation, not a screen anybody at a hotel has a
         reason to open, and it carries its own sample guest names into
         the bundle. */
      { label: "Design system", to: "/design-system", icon: Palette,
        resource: "dashboard", devOnly: true },
    ],
  },
];

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

/** Flat list of every reachable route — feeds the command palette. */
export function flatNavigationFor(role: Role, code = ""): NavItem[] {
  const out: NavItem[] = [];
  for (const section of navigationFor(role, code)) {
    for (const item of section.items) {
      if (visible(role, item)) out.push(item);
      for (const child of item.children ?? []) {
        if (!out.some((existing) => existing.to === child.to)) out.push(child);
      }
    }
  }
  return out;
}