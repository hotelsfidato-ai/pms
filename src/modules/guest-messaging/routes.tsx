import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import GuestMessagesPage from "@/modules/guest-messaging/pages/GuestMessages";

/* Guest messages's one address. Mounted by App.tsx inside the signed-in
   shell, and scoped to a property like everything under `/h/:code/`.

   GUARDED. The guard asks the navigation (`mayReach`), so the page is
   refused to exactly the people the menu does not show it to - and the
   server refuses them as well, on the same list of roles, which is the
   half that matters.

   The Coming soon page it replaces is gone: this service is built, and a
   Coming soon page beside a working screen is two answers to one
   question. */
export const routes = (
  <Route
    path="/h/:code/guest-messages"
    element={
      <RequireAccess path="/h/:code/guest-messages" resource="reservation">
        <PropertyScope /><GuestMessagesPage />
      </RequireAccess>
    }
  />
);
