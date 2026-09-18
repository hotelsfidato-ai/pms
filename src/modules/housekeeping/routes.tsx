import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import HousekeepingPage from "@/modules/housekeeping/pages/Housekeeping";
import WorkOrdersPage from "@/modules/housekeeping/pages/WorkOrders";

/* Housekeeping's screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/housekeeping"
      element={<><PropertyScope /><HousekeepingPage /></>}
    />
    {/* What needs fixing. Not the same as a room being out. */}
    <Route
      path="/h/:code/work-orders"
      element={<><PropertyScope /><WorkOrdersPage /></>}
    />
  </>
);
