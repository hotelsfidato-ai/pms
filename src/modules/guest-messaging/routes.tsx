import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import GuestMessagingPage from "@/modules/guest-messaging/pages/GuestMessaging";

/* Guest messages's one address — its Coming soon page. Mounted by App.tsx inside
   the signed-in shell. The guard asks the navigation (`mayReach`), so the
   page is refused to exactly the people the menu does not show it to. */
export const routes = (
  <Route
    path="/coming-soon/guest-messaging"
    element={
      <RequireAccess path="/coming-soon/guest-messaging" resource="integration">
        <GuestMessagingPage />
      </RequireAccess>
    }
  />
);
