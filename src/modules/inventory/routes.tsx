import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import RoomSetupPage from "@/pages/RoomSetup";
import RatePlansEditor from "@/pages/RatePlans";
import CancellationTermsPage from "@/pages/CancellationTerms";
import RatesPage from "@/pages/Rates";
import GridsPage from "@/pages/Grids";

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
