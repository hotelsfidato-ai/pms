import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import StoresPage from "@/modules/stores/pages/Stores";
import StoreDaysPage from "@/modules/stores/pages/StoreDays";
import InventoryPage from "@/modules/stores/pages/Inventory";
import BarStockPage from "@/modules/stores/pages/BarStock";
import KitchenStockPage from "@/modules/stores/pages/KitchenStock";

/* The store's screen address. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    {/* What the property keeps, and where it went. GUARDED (STO-1): a role
        with no `stock` grant — reception, the till, the revenue manager — is
        told so rather than shown the page. The server refuses them too. */}
    <Route
      path="/h/:code/stores"
      element={
        <RequireAccess path="/h/:code/stores" resource="stock">
          <PropertyScope /><StoresPage />
        </RequireAccess>
      }
    />
    {/* The Store's fourteen days (D27-238): the Shelf's pair, like Rooms and
        the Calendar, under the same menu entry and the same grant. */}
    <Route
      path="/h/:code/stores/days"
      element={
        <RequireAccess path="/h/:code/stores" resource="stock">
          <PropertyScope /><StoreDaysPage />
        </RequireAccess>
      }
    />
    {/* Inventory: the bar's stock, the restaurant's to come (D27-354). */}
    <Route
      path="/h/:code/inventory"
      element={
        <RequireAccess path="/h/:code/inventory" resource="stock">
          <PropertyScope /><InventoryPage />
        </RequireAccess>
      }
    />
    {/* Bar stock, in the Restaurant menu (D27-354): the bar's sheet, bills
        and set up - Inventory's Bar tab, reached from where the bar works. */}
    <Route
      path="/pos/:code/bar-stock"
      element={
        <RequireAccess path="/pos/:code/bar-stock" resource="stock">
          <PropertyScope /><BarStockPage />
        </RequireAccess>
      }
    />
    {/* Kitchen stock, in the kitchen manager's and the chef's Restaurant menu
        (D27-378): Inventory's Restaurant tab, reached from where the kitchen works. */}
    <Route
      path="/pos/:code/kitchen-stock"
      element={
        <RequireAccess path="/pos/:code/kitchen-stock" resource="stock">
          <PropertyScope /><KitchenStockPage />
        </RequireAccess>
      }
    />
  </>
);
