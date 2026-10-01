import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import LoyaltyPage from "@/modules/loyalty/pages/Loyalty";

/* Loyalty's one address. It was `/coming-soon/loyalty` until the service was
   built (30 September). The guard asks the navigation (`mayReach`); the
   server refuses the same people (roleGate.ts, `customer` view). */
export const routes = (
  <Route
    path="/h/:code/loyalty"
    element={
      <RequireAccess path="/h/:code/loyalty" resource="customer">
        <PropertyScope /><LoyaltyPage />
      </RequireAccess>
    }
  />
);
