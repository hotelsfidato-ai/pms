import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";
import RatePlansEditor from "@/modules/inventory/pages/RatePlans";
import CancellationTermsPage from "@/modules/inventory/pages/CancellationTerms";
import RatesPage from "@/modules/inventory/pages/Rates";
import GridsPage from "@/modules/inventory/pages/Grids";

/* Inventory and rates' screen addresses. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/room-types"
      element={<><PropertyScope /><RoomSetupPage /></>}
    />
    <Route
      path="/h/:code/rate-plans"
      element={<><PropertyScope /><RatePlansEditor /></>}
    />
    <Route
      path="/h/:code/cancellation-terms"
      element={<><PropertyScope /><CancellationTermsPage /></>}
    />
    <Route
      path="/h/:code/rates"
      element={<><PropertyScope /><RatesPage /></>}
    />
    {/* The revenue manager's day: how many rooms are left, and
        what they cost. One window, two tabs, because the two
        questions are asked together. */}
    <Route
      path="/h/:code/grids"
      element={<><PropertyScope /><GridsPage /></>}
    />
  </>
);
