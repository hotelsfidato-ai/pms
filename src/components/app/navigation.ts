import {
  LayoutDashboard, CalendarCheck, Users, Building2, Hotel, Receipt,
  BarChart3, Bell, Settings, ShieldCheck, CalendarRange,
  FileText, Wallet, Plug, ScrollText,
  UserCog, Palette, BookOpen, Home, ClipboardList, type LucideIcon,
} from "lucide-react";
import { canAccess, type Resource, type Role } from "@/lib/permissions";

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
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Folios", to: "/h/:code/folios", icon: Receipt, resource: "invoice", matchPrefix: true },
      { label: "Invoices", to: "/h/:code/invoices", icon: FileText, resource: "invoice", matchPrefix: true },
      { label: "Payments", to: "/h/:code/payments", icon: Wallet, resource: "payment" },
      { label: "City ledger", to: "/h/:code/city-ledger", icon: Building2, resource: "commission" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Night Audit", to: "/h/:code/night-audit", icon: BarChart3, resource: "report" },
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