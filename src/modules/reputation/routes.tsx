import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import ReviewsPage from "@/modules/reputation/pages/Reviews";
import FeedbackPage from "@/modules/reputation/pages/Feedback";

/* Reviews's addresses. Mounted by App.tsx inside the signed-in shell.

   It was `/coming-soon/reputation` until 19 September; the service is built
   now, so the Coming soon page is gone and this is a working screen at a
   working address.

   GUARDED. The guard asks the navigation (`mayReach`), so the page is refused
   to exactly the people the menu does not show it to - and the server refuses
   them as well, which is the half that matters. Guest feedback (D27-383
   item 10) the same way. */
export const routes = (
  <>
    <Route
      path="/h/:code/reviews"
      element={
        <RequireAccess path="/h/:code/reviews" resource="customer">
          <PropertyScope /><ReviewsPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/feedback"
      element={
        <RequireAccess path="/h/:code/feedback" resource="customer">
          <PropertyScope /><FeedbackPage />
        </RequireAccess>
      }
    />
  </>
);
