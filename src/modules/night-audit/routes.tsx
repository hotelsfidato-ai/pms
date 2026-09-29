import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import NightAuditPage from "@/modules/night-audit/pages/NightAudit";

/* The night audit's screen address. Mounted by App.tsx inside the
   signed-in shell. Guarded by its menu entry since 28 September: the
   server refuses its reads to a role without `report` (D27-141). */
export const routes = (
  <>
    <Route
      path="/h/:code/night-audit"
      element={<RequireAccess path="/h/:code/night-audit" resource="report"><PropertyScope /><NightAuditPage /></RequireAccess>}
    />
  </>
);
