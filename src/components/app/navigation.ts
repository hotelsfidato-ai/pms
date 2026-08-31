import {
  LayoutDashboard, CalendarCheck, Users, Building2, Hotel, Receipt,
  BarChart3, Bell, Settings, ShieldCheck, CalendarRange,
  FileText, Wallet, Plug, ScrollText,
  UserCog, Palette, BookOpen, Home, ClipboardList, type LucideIcon, ShieldAlert, UtensilsCrossed,
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
}

/** Whether the given role should see this entry at all. */
const visible = (role: Role, item: NavItem): boolean =>
  item.canSee ? item.canSee(role) : canAccess(role, item.resource);

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
  label?: string;
  items: NavItem[];
}

/* PMS tree — Stay View is home. The front desk lives there all day.
   The dashboard is for people who are not working a shift.           */
const SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Group", to: "/", icon: LayoutDashboard, resource: "dashboard" },
      { label: "Stay View", to: "/h/:code/stay", icon: Home, resource: "dashboard" },
    ],
  },
  {
    label: "Front Desk",
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
        label: "In-House", to: "/h/:code/in-house", icon: Users,
        resource: "reservation", matchPrefix: true,
        children: [
          { label: "Current stays", to: "/h/:code/in-house", icon: Users, resource: "reservation" },
          { label: "Due out", to: "/h/:code/in-house/due-out", icon: CalendarRange, resource: "reservation" },
        ],
      },
      { label: "Walk-ins", to: "/h/:code/walk-ins", icon: BookOpen, resource: "reservation" },
      { label: "Housekeeping", to: "/h/:code/housekeeping", icon: ClipboardList, resource: "inventory" },
    ],
  },
  {
    label: "Reservations",
    items: [
      {
        label: "All reservations", to: "/h/:code/reservations", icon: CalendarCheck,
        resource: "reservation", matchPrefix: true,
        children: [
          { label: "List", to: "/h/:code/reservations", icon: CalendarCheck, resource: "reservation" },
          { label: "Calendar", to: "/h/:code/stay", icon: CalendarRange, resource: "reservation" },
        ],
      },
      { label: "Guests", to: "/guests", icon: Users, resource: "customer", matchPrefix: true },
      { label: "Companies", to: "/companies", icon: Building2, resource: "company", matchPrefix: true },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Properties", to: "/properties", icon: Hotel, resource: "hotel", matchPrefix: true },
      { label: "Room types", to: "/h/:code/room-types", icon: LayoutDashboard, resource: "room_config" },
      { label: "Rate plans", to: "/h/:code/rate-plans", icon: Wallet, resource: "rate" },
      { label: "Rates", to: "/h/:code/rates", icon: BarChart3, resource: "rate" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Folios", to: "/h/:code/folios", icon: Receipt, resource: "invoice", matchPrefix: true },
      { label: "Invoices", to: "/h/:code/invoices", icon: FileText, resource: "invoice", matchPrefix: true },
      { label: "Payments", to: "/h/:code/payments", icon: Wallet, resource: "payment" },
      { label: "City ledger", to: "/h/:code/city-ledger", icon: Building2, resource: "commission" },
      /* Form C is a COMPLIANCE obligation about guests, not a finance
         document — but it is filed by the same person who bills, at the
         same desk, and burying it under Reports is how a 24-hour
         deadline gets missed. It sits where somebody will see it. */
      { label: "Form C", to: "/h/:code/form-c", icon: ShieldAlert, resource: "customer" },
      /* What the restaurant sent and what was refused. Under Finance
         because the argument it settles is about money on a folio, and
         the person settling it is the one who bills. */
      { label: "Point of sale", to: "/h/:code/pos", icon: UtensilsCrossed, resource: "invoice" },
      /* The till is a different job from reading what a till sent, and a
         different person does it. It sits next to its sibling so nobody
         has to learn that "Point of sale" is the read-only one. */
      { label: "Till", to: "/h/:code/till", icon: Receipt, resource: "payment" },
      /* The prices, which are the hotel's. Behind the same permission as
         rates, because setting what a dish costs is the same kind of act
         as setting what a room costs. */
      { label: "Menu", to: "/h/:code/menu", icon: UtensilsCrossed, resource: "rate" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Night Audit", to: "/h/:code/night-audit", icon: BarChart3, resource: "report" },
      /* The index first — it is the taxonomy, and the seven below are
         the shortcuts a manager pins for themselves. */
      { label: "All reports", to: "/reports", icon: FileText, resource: "report" },
      { label: "Manager Report", to: "/reports/manager", icon: BarChart3, resource: "report" },
      { label: "City Ledger", to: "/reports/city-ledger", icon: Building2, resource: "report" },
      { label: "No Show", to: "/reports/no-show", icon: CalendarCheck, resource: "report" },
      { label: "Monthly Occupancy", to: "/reports/monthly-occupancy", icon: BarChart3, resource: "report" },
      { label: "Monthly Statistics", to: "/reports/monthly-stats", icon: BarChart3, resource: "report" },
      { label: "Yearly Statistics", to: "/reports/yearly-stats", icon: BarChart3, resource: "report" },
      { label: "Lodging Tax", to: "/reports/lodging-tax", icon: FileText, resource: "report" },
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
          /* Every role can READ the property list — that entry lives
             under Inventory. This one is about adding one, so it is
             gated on the create grant. Without that override the front
             desk inherits an /admin path through its read access. */
          {
            label: "Properties", to: "/admin/properties", icon: Hotel, resource: "hotel",
            canSee: (role) => can(role, "create", "hotel"),
          },
          { label: "Users", to: "/admin/users", icon: UserCog, resource: "user" },
          { label: "Roles & permissions", to: "/admin/roles", icon: ShieldCheck, resource: "role" },
          { label: "Integrations", to: "/admin/integrations", icon: Plug, resource: "integration" },
          { label: "Audit log", to: "/admin/audit-log", icon: ScrollText, resource: "audit_log" },
          { label: "Settings", to: "/admin/settings", icon: Settings, resource: "setting" },
        ],
      },
      { label: "Design system", to: "/design-system", icon: Palette, resource: "dashboard" },
    ],
  },
];

/** Sections and items the given role can actually reach. */
/** Substitutes the property into any `/h/:code/...` path. */
function resolve(path: string, code: string): string {
  return path.replace(":code", code);
}

export function navigationFor(role: Role, code = ""): NavSection[] {
  return SECTIONS.map((section) => ({
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