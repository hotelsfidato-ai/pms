import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import ReviewsPage from "@/modules/reputation/pages/Reviews";

/* Reviews's one address. Mounted by App.tsx inside the signed-in shell.

   It was `/coming-soon/reputation` until 19 September; the service is built
   now, so the Coming soon page is gone and this is a working screen at a
   working address.

   GUARDED. The guard asks the navigation (`mayReach`), so the page is refused
   to exactly the people the menu does not show it to - and the server refuses
   them as well, which is the half that matters. */
export const routes = (
  <Route
    path="/h/:code/reviews"
    element={
      <RequireAccess path="/h/:code/reviews" resource="customer">
        <PropertyScope /><ReviewsPage />
      </RequireAccess>
    }
  />
);
