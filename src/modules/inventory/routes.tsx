import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";
import RatePlansEditor from "@/modules/inventory/pages/RatePlans";
import CancellationTermsPage from "@/modules/inventory/pages/CancellationTerms";
import RatesPage from "@/modules/inventory/pages/Rates";
import GridsPage from "@/modules/inventory/pages/Grids";
import PricingPage from "@/modules/inventory/pages/Pricing";

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
    {/* Where a price COMES FROM: one base figure and a difference for
        everything else. Guarded, unlike its neighbours, because it moves
        every price in the property at once and PEO-1 was the lesson that a
        hidden menu entry is not a closed door. */}
    <Route
      path="/h/:code/pricing"
      element={
        <RequireAccess path="/h/:code/pricing" resource="rate">
          <PropertyScope /><PricingPage />
        </RequireAccess>
      }
    />
    {/* The revenue manager's day: how many rooms are left, and
        what they cost. One window, two tabs, because the two
        questions are asked together. Guarded like Pricing, because it
        sets a price on a run of dates (INV-5, approved 16 September). */}
    <Route
      path="/h/:code/grids"
      element={
        <RequireAccess path="/h/:code/grids" resource="rate">
          <PropertyScope /><GridsPage />
        </RequireAccess>
      }
    />
  </>
);
