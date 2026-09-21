import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
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

/* The desk's screen. Mounted by App.tsx inside the signed-in shell. Its Coming
   soon page went on 21 September, when the entry moved to Front desk (D21-89).
   The guard asks the navigation (`mayReach`), so the screen is refused to
   exactly the people the menu does not show it to — and the SERVER refuses
   every role but the desk's too (guestDoor.ts, DESK_ROLES). */
export const routes = (
  <Route
    path="/h/:code/online-checkin"
    element={
      <RequireAccess path="/h/:code/online-checkin" resource="customer">
        <PropertyScope /><DeskPage />
      </RequireAccess>
    }
  />
);
