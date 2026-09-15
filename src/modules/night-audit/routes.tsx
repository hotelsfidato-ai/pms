import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import NightAuditPage from "@/pages/NightAudit";

/* The night audit's screen address. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/night-audit"
      element={<><PropertyScope /><NightAuditPage /></>}
    />
  </>
);
