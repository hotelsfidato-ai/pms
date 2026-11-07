import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import HousekeepingPage from "@/modules/housekeeping/pages/Housekeeping";
import WorkOrdersPage from "@/modules/housekeeping/pages/WorkOrders";
import MinibarPage from "@/modules/housekeeping/pages/Minibar";
import ChecklistsPage from "@/modules/housekeeping/pages/Checklists";

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
    {/* D27-383 item 10: the minibar, and the housekeeping checklists. */}
    <Route
      path="/h/:code/minibar"
      element={<RequireAccess path="/h/:code/minibar" resource="inventory"><PropertyScope /><MinibarPage /></RequireAccess>}
    />
    <Route
      path="/h/:code/checklists"
      element={<RequireAccess path="/h/:code/checklists" resource="inventory"><PropertyScope /><ChecklistsPage /></RequireAccess>}
    />
  </>
);
