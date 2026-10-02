import {
  LayoutDashboard, FileText, BarChart3, Building2, CalendarCheck, ScrollText, ShieldCheck,
  BookOpen, Banknote, Hotel,
} from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { can, type Role } from "@/lib/permissions";

/* Money owed and money taken: the server asks `invoice` view of these
   three reports (roleGate MONEY_REPORT), and so does the menu - the owner's
   D27-147: not the revenue manager, who keeps every other report. */
const seesMoney = (role: Role): boolean => can(role, "view", "invoice");

/* Reports' menu entries: the Dashboard at the top of the menu, and the
   Reports section after the night audit. Three are listed for everybody;
   the rest are one search away (owner, 15 September). */
export const nav: ServiceNavEntry[] = [
  { section: "home", order: 10, workingMenus: ["front_desk"],
    label: "Dashboard", to: "/", icon: LayoutDashboard, resource: "dashboard" },
  /* Every property on one page, for the owner (D27-243): who adds properties. */
  { section: "across-properties", order: 5, label: "All properties", to: "/all-properties", icon: Hotel, resource: "report", canSee: (role) => can(role, "create", "hotel"), keywords: ["group", "every property", "every hotel"] },
  /* The index first — it is the taxonomy, and the seven below are
     the shortcuts a manager pins for themselves. */
  { section: "reports", order: 20,
    label: "All reports", to: "/reports", icon: FileText, resource: "report" },
  { section: "reports", order: 30,
    label: "Manager report", to: "/reports/manager", icon: BarChart3, resource: "report",
    keywords: ["flash", "daily report"] },
  /* The printed night audit, the owner's decision of 17 September: in
     All reports, not on the screen that runs the audit. */
  { section: "reports", order: 35,
    label: "Night audit report", to: "/reports/night-audit", icon: ScrollText, resource: "report",
    keywords: ["audit", "close of day", "day end"], listed: false },
  { section: "reports", order: 40,
    label: "City ledger", to: "/reports/city-ledger", icon: Building2, resource: "report",
    canSee: seesMoney,
    keywords: ["company accounts", "receivables"], listed: false },
  { section: "reports", order: 50,
    label: "No show", to: "/reports/no-show", icon: CalendarCheck, resource: "report", listed: false },
  { section: "reports", order: 60,
    label: "Monthly occupancy", to: "/reports/monthly-occupancy", icon: BarChart3, resource: "report", listed: false },
  { section: "reports", order: 70,
    label: "Monthly statistics", to: "/reports/monthly-stats", icon: BarChart3, resource: "report", listed: false },
  { section: "reports", order: 80,
    label: "Yearly statistics", to: "/reports/yearly-stats", icon: BarChart3, resource: "report", listed: false },
  { section: "reports", order: 90,
    label: "Lodging tax", to: "/reports/lodging-tax", icon: FileText, resource: "report",
    keywords: ["gst", "tax return"], listed: false },
  /* FOUR THAT WERE BUILT AND NOT LISTED. The index says "11 of 11
     built" and this menu offered seven — so the GST Sales Register,
     the one an accountant needs every month to file GSTR-1, was
     reachable only by somebody who thought to open All reports
     first and read down it.

     A screen that exists and cannot be found from the navigation is
     a screen that does not exist to the person looking for it. */
  { section: "reports", order: 100,
    label: "GST sales register", to: "/reports/gst-sales", icon: ScrollText, resource: "report", listed: false },
  /* D25-38: passports and visas - the check-in roles only, as the server. */
  { section: "reports", order: 110,
    label: "Form III register", to: "/reports/c-form", icon: ShieldCheck, resource: "report",
    canSee: (role) => can(role, "edit", "customer"),
    keywords: ["foreign", "frro", "form c"], listed: false },
  { section: "reports", order: 120,
    label: "Guest ledger", to: "/reports/guest-ledger", icon: BookOpen, resource: "report",
    canSee: seesMoney, listed: false },
  { section: "reports", order: 130,
    label: "Cashier shift", to: "/reports/cashier-shift", icon: Banknote, resource: "report",
    canSee: seesMoney,
    keywords: ["drawer", "takings"], listed: false },
];
