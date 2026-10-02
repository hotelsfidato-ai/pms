import { describe, it, expect } from "vitest";
import { ROLES } from "@/lib/permissions";
import { mayReach } from "@/components/app/navigation";
import { mayReadStockReports, STOCK_REPORTS_PATH, STOCK_REPORT_LINKS } from "@/modules/reports";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S "REPORTS" BUTTON LANDS HERE (D27-240; the master's T-1)

   The Inventory Manager holds no `report` (D27-141), so All reports is
   closed to them. The Store page links to this address instead: the nine
   Store and equipment reports, open to exactly D27-240's seven readers,
   one list (mayReadStockReports) the Store and this menu both ask.
   ══════════════════════════════════════════════════════════════════ */

describe("the store reports' own address", () => {
  it("is open to exactly D27-240's readers, the Inventory Manager included", () => {
    expect(STOCK_REPORTS_PATH).toBe("/reports/store");
    const people = ROLES.filter((r) => r !== "automation");
    expect(people.filter(mayReadStockReports))
      .toEqual(["owner", "admin", "gm", "hotel_manager", "stores", "finance", "read_only"]);
    for (const role of people) {
      expect(mayReach(role, STOCK_REPORTS_PATH), role).toBe(mayReadStockReports(role));
    }
    expect(mayReach("stores", "/reports"), "All reports stays closed to them").toBe(false);
  });

  it("names the nine in the menu's own words, for the Store's Reports menu", () => {
    expect(STOCK_REPORT_LINKS.map((l) => l.label)).toEqual([
      "Closing stock", "Stock movement by day", "Consumption", "Wastage and breakage", "Count differences",
      "Dead stock", "Days of cover", "Supplier spend", "Equipment report",
    ]);
    for (const l of STOCK_REPORT_LINKS) expect(mayReach("stores", l.path), l.path).toBe(true);
  });
});
