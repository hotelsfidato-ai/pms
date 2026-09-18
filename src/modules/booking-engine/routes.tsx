import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import BookingEnginePage from "@/modules/booking-engine/pages/BookingEngine";

/* Booking engine's one address — its Coming soon page. Mounted by App.tsx inside
   the signed-in shell. The guard asks the navigation (`mayReach`), so the
   page is refused to exactly the people the menu does not show it to. */
export const routes = (
  <Route
    path="/coming-soon/booking-engine"
    element={
      <RequireAccess path="/coming-soon/booking-engine" resource="integration">
        <BookingEnginePage />
      </RequireAccess>
    }
  />
);
