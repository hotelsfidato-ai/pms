import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import MarketingPage from "@/modules/marketing/pages/Marketing";

/* Marketing's one address. It was `/coming-soon/marketing` until the numbers
   were built (29 September). GUARDED by the navigation (`mayReach`) and by
   the server (roleGate.ts, `marketing` view). */
export const routes = (
  <Route
    path="/h/:code/marketing"
    element={
      <RequireAccess path="/h/:code/marketing" resource="marketing">
        <PropertyScope /><MarketingPage />
      </RequireAccess>
    }
  />
);
