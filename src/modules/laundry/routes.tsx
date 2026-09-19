import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import LaundryDocketsPage from "@/modules/laundry/pages/Dockets";
import LaundryPriceListPage from "@/modules/laundry/pages/PriceList";
import LaundryDocketPage from "@/modules/laundry/pages/Docket";

/* Laundry's three addresses. Mounted by App.tsx inside the signed-in shell.

   GUARDED, all three. The guard asks the navigation (`mayReach`), so a page
   is refused to exactly the people the menu does not show it to. The
   navigation hides the whole section where the property has laundry switched
   off, and the server refuses every route independently of both — a hidden
   menu entry is still a URL anybody can type, which is the half that matters.

   `price-list` sits BEFORE `:id` — otherwise react-router could read it as a
   docket whose id is the words "price-list", and the price list becomes a
   "No such docket." nobody can explain (purchasing's `who-may-ask` is the
   same trap, found the same way). */
export const routes = (
  <>
    <Route
      path="/h/:code/laundry"
      element={
        <RequireAccess path="/h/:code/laundry" resource="laundry">
          <PropertyScope /><LaundryDocketsPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/laundry/price-list"
      element={
        <RequireAccess path="/h/:code/laundry/price-list" resource="laundry">
          <PropertyScope /><LaundryPriceListPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/laundry/:id"
      element={
        <RequireAccess path="/h/:code/laundry" resource="laundry">
          <PropertyScope /><LaundryDocketPage />
        </RequireAccess>
      }
    />
  </>
);
