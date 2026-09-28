import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import HousekeepingPage from "@/modules/housekeeping/pages/Housekeeping";
import WorkOrdersPage from "@/modules/housekeeping/pages/WorkOrders";

/* Housekeeping's screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/housekeeping"
      /* Guarded since the board asks for bookings (D27-142). */
      element={<RequireAccess path="/h/:code/housekeeping" resource="inventory"><PropertyScope /><HousekeepingPage /></RequireAccess>}
    />
    {/* What needs fixing. Not the same as a room being out. */}
    <Route
      path="/h/:code/work-orders"
      element={<><PropertyScope /><WorkOrdersPage /></>}
    />
  </>
);
