import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import StayViewPage from "@/modules/front-desk/pages/StayView";
import ArrivalsPage from "@/modules/front-desk/pages/Arrivals";
import InHousePage from "@/modules/front-desk/pages/InHouse";
import WalkInsPage from "@/modules/front-desk/pages/WalkIns";

/* Front desk's screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    {/* ROOMS AND CALENDAR ARE TWO SCREENS (14 September). They
        were one address with a toggle, and the menu's "Calendar"
        link opened it on Rooms. `/stay` stays Rooms, because every
        deep link to a booking (?res=) already points there. */}
    <Route
      path="/h/:code/stay"
      /* Guarded since Rooms asks for bookings (D27-142). */
      element={<RequireAccess path="/h/:code/stay" resource="reservation"><PropertyScope /><StayViewPage view="floor" /></RequireAccess>}
    />
    <Route
      path="/h/:code/calendar"
      element={<><PropertyScope /><StayViewPage view="calendar" /></>}
    />
    <Route
      path="/h/:code/arrivals"
      element={<><PropertyScope /><ArrivalsPage /></>}
    />
    <Route
      path="/h/:code/arrivals/upcoming"
      element={<><PropertyScope /><ArrivalsPage /></>}
    />
    <Route
      path="/h/:code/in-house"
      element={<><PropertyScope /><InHousePage /></>}
    />
    <Route
      path="/h/:code/in-house/due-out"
      element={<><PropertyScope /><InHousePage /></>}
    />
    <Route
      path="/h/:code/walk-ins"
      element={<><PropertyScope /><WalkInsPage /></>}
    />
  </>
);
