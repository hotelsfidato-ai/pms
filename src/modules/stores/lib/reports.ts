import type { Role } from "@/lib/permissions";

/* THE STORE'S WAY INTO ITS REPORTS (D27-238 phase 3A, D27-240). The Inventory
   Manager has no All reports in their menu (D27-141), so the Store links to
   the nine stock and equipment reports the reports lane builds.

   ⚠ A COPY, FOR NOW: the reports lane will export the addresses and
   `mayReadStockReports(role)` from its front door; until it lands, the seven
   roles of D27-240 are pinned here and by stores.test.tsx. When it lands,
   this file goes and the Store imports theirs. */

export const STOCK_REPORTS: { key: string; label: string }[] = [
  { key: "stock-on-hand", label: "Stock on hand" },
  { key: "stock-movements", label: "Movements" },
  { key: "stock-consumption", label: "Consumption" },
  { key: "stock-wastage", label: "Wastage and breakage" },
  { key: "stock-count-differences", label: "Count differences" },
  { key: "stock-dead", label: "Dead stock" },
  { key: "stock-cover", label: "Days of cover" },
  { key: "supplier-spend", label: "Supplier spend" },
  { key: "equipment", label: "Equipment" },
];

/** D27-240: the owner, an administrator, the GM, the hotel manager, the
    Inventory Manager, the accountant and a viewer. */
export const STOCK_REPORT_ROLES: readonly Role[] = [
  "owner", "admin", "gm", "hotel_manager", "stores", "finance", "read_only",
];

export const mayReadStockReports = (role: Role | null | undefined) =>
  role !== null && role !== undefined && STOCK_REPORT_ROLES.includes(role);
