import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import LeadsPage from "@/modules/leads/pages/Leads";

/* Leads and WhatsApp's one address. It was `/coming-soon/leads` until the
   service was built (29 September). GUARDED: the guard asks the navigation
   (`mayReach`), and the server refuses the same people (roleGate.ts,
   READ_RULES, `customer` view), which is the half that matters. */
export const routes = (
  <Route
    path="/h/:code/leads"
    element={
      <RequireAccess path="/h/:code/leads" resource="customer">
        <PropertyScope /><LeadsPage />
      </RequireAccess>
    }
  />
);
