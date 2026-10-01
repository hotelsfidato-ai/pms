import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import RequestsPage from "@/modules/guest-services/pages/Requests";

/* Guest requests (D27-178, D27-181). Mounted by App.tsx inside the signed-in
   shell. The guard asks the navigation (`mayReach`), so the page is refused
   to exactly the people the menu does not show it to. */
export const routes = (
  <Route
    path="/h/:code/requests"
    element={
      <RequireAccess path="/h/:code/requests" resource="reservation">
        <RequestsPage />
      </RequireAccess>
    }
  />
);
