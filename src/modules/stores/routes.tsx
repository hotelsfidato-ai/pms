import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import StoresPage from "@/modules/stores/pages/Stores";
import StoreDaysPage from "@/modules/stores/pages/StoreDays";

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
  </>
);
