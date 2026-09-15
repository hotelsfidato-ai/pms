import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import StayViewPage from "@/pages/StayView";
import ArrivalsPage from "@/pages/Arrivals";
import InHousePage from "@/pages/InHouse";
import WalkInsPage from "@/pages/WalkIns";

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
      element={<><PropertyScope /><StayViewPage view="floor" /></>}
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
