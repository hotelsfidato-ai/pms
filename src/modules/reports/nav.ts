import {
  LayoutDashboard, FileText, BarChart3, Building2, CalendarCheck, ScrollText, ShieldCheck,
  BookOpen, Banknote, Boxes, ArrowLeftRight, PackageOpen, Trash2, ClipboardCheck, Hourglass,
  Gauge, Truck, Refrigerator, Warehouse,
} from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { can, type Role } from "@/lib/permissions";

/* Money owed and money taken: the server asks `invoice` view of these
   three reports (roleGate MONEY_REPORT), and so does the menu - the owner's
   D27-147: not the revenue manager, who keeps every other report. */
const seesMoney = (role: Role): boolean => can(role, "view", "invoice");

/* The Store and equipment reports (phase 3A; the owner's D27-240 R-1): whoever
   holds the Store's export, and the hotel manager and the Viewer - the
   server's rule (roleGate STORE_REPORTS), asked the same way. */
export const mayReadStockReports = (role: Role): boolean =>
  can(role, "export", "stock") || role === "hotel_manager" || role === "read_only";

/* Where the Store page's "Reports" button lands (D27-240; the master's T-1):
   the nine on one page, for the Inventory Manager too, who cannot open
   All reports (no `report`, D27-141). */
export const STOCK_REPORTS_PATH = "/reports/store";

/* Reports' menu entries: the Dashboard at the top of the menu, and the
   Reports section after the night audit. Three are listed for everybody;
   the rest are one search away (owner, 15 September). */
export const nav: ServiceNavEntry[] = [
  { section: "home", order: 10, workingMenus: ["front_desk"],
    label: "Dashboard", to: "/", icon: LayoutDashboard, resource: "dashboard" },
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
  /* The Store and equipment (phase 3A): one search away, and in All reports. */
  { section: "reports", order: 145,
    label: "Store reports", to: STOCK_REPORTS_PATH, icon: Warehouse, resource: "stock",
    canSee: mayReadStockReports, keywords: ["stock reports", "store", "equipment"], listed: false },
  { section: "reports", order: 150,
    label: "Closing stock", to: "/reports/stock-on-hand", icon: Boxes, resource: "stock",
    canSee: mayReadStockReports, keywords: ["stock value", "store value", "inventory value"], listed: false },
  { section: "reports", order: 160,
    label: "Stock movement by day", to: "/reports/stock-movements", icon: ArrowLeftRight, resource: "stock",
    canSee: mayReadStockReports, keywords: ["received", "issued", "store"], listed: false },
  { section: "reports", order: 170,
    label: "Consumption", to: "/reports/stock-consumption", icon: PackageOpen, resource: "stock",
    canSee: mayReadStockReports, keywords: ["usage", "issued", "outlet", "store"], listed: false },
  { section: "reports", order: 180,
    label: "Wastage", to: "/reports/stock-wastage", icon: Trash2, resource: "stock",
    canSee: mayReadStockReports, keywords: ["waste", "spoilage", "store"], listed: false },
  { section: "reports", order: 190,
    label: "Count differences", to: "/reports/stock-count-differences", icon: ClipboardCheck, resource: "stock",
    canSee: mayReadStockReports, keywords: ["stock count", "variance", "store"], listed: false },
  { section: "reports", order: 200,
    label: "Dead stock", to: "/reports/stock-dead", icon: Hourglass, resource: "stock",
    canSee: mayReadStockReports, keywords: ["slow moving", "unused", "store"], listed: false },
  { section: "reports", order: 210,
    label: "Days of cover", to: "/reports/stock-cover", icon: Gauge, resource: "stock",
    canSee: mayReadStockReports, keywords: ["stock cover", "how long", "store"], listed: false },
  { section: "reports", order: 220,
    label: "Supplier spend", to: "/reports/supplier-spend", icon: Truck, resource: "stock",
    canSee: mayReadStockReports, keywords: ["purchases", "suppliers", "prices"], listed: false },
  { section: "reports", order: 230,
    label: "Equipment report", to: "/reports/equipment", icon: Refrigerator, resource: "stock",
    canSee: mayReadStockReports, keywords: ["warranty", "amc", "under repair", "out of store"], listed: false },
];
