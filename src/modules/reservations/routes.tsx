import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import ReservationsPage from "@/modules/reservations/pages/Reservations";
import BookingPage from "@/modules/reservations/pages/BookingPage";
import GroupsPage from "@/modules/reservations/pages/Groups";
import GroupPanelPage from "@/modules/reservations/pages/GroupPanel";

/* Reservations' screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/reservations"
      element={<><PropertyScope /><ReservationsPage /></>}
    />
    {/* One page for booking, giving a room and checking in (D27-158); a
        walk-in is the same page, ?room=&date= (D27-163). */}
    <Route
      path="/h/:code/book"
      element={<><PropertyScope /><BookingPage /></>}
    />
    {/* The LIST. The panel below has existed since 056 and could
        be reached only by somebody who already knew a group's
        id — no list, no navigation entry, no way in. Before the
        parameterised route, so a literal segment cannot be
        swallowed by an :id. */}
    <Route
      path="/h/:code/groups"
      element={<><PropertyScope /><GroupsPage /></>}
    />
    {/* One group: its rooms, and who pays for which. */}
    <Route
      path="/h/:code/groups/:id"
      element={<><PropertyScope /><GroupPanelPage /></>}
    />
  </>
);
