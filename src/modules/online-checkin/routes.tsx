import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import OnlineCheckinPage from "@/modules/online-checkin/pages/OnlineCheckin";
import GuestPage from "@/modules/online-checkin/pages/GuestPage";
import DeskPage from "@/modules/online-checkin/pages/Desk";
import { PropertyScope } from "@/components/app/PropertyScope";

/* ⚠ THE GUEST'S OWN PAGE IS NOT IN THE ROUTES BELOW, AND MUST NOT BE.
   Those sit inside `RequireSession` in `App.tsx`; this one is opened by
   somebody who has no sign-in and never will, so it is exported on its
   own for `App.tsx` to mount OUTSIDE the session gate, beside /signin.
   The token in the address is the whole credential (migration 114), and
   everything behind the six-digit code is refused by the SERVER. */
export const publicRoutes = (
  <Route path="/g/:token" element={<GuestPage />} />
);

/* Online check-in's one address — its Coming soon page. Mounted by App.tsx inside
   the signed-in shell. The guard asks the navigation (`mayReach`), so the
   page is refused to exactly the people the menu does not show it to. */
export const routes = (
  <>
    <Route
      path="/coming-soon/online-checkin"
      element={
        <RequireAccess path="/coming-soon/online-checkin" resource="integration">
          <OnlineCheckinPage />
        </RequireAccess>
      }
    />
    {/* The desk's side (21 September). No menu entry of its own yet: moving
        "Online check-in" out of the Coming soon section changes the list
        the master's navigation test pins, so that move is the master's
        (MODULE.md). Until then it is reached by its address, and the
        SERVER refuses every role but the desk's (guestDoor.ts, DESK_ROLES). */}
    <Route
      path="/h/:code/online-checkin"
      element={<><PropertyScope /><DeskPage /></>}
    />
  </>
);
