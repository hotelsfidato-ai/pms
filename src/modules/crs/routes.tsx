import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import CrsBookingsPage from "@/modules/crs/pages/CrsBookings";

/* The CRS bridge's one address (D27-168). Mounted by App.tsx inside the
   signed-in shell, scoped to a property like everything under `/h/:code/`.

   GUARDED on `reservation`, as the server's read is: whoever may see the
   hotel's bookings sees the ones the CRS sold. The mapping card on it is
   the owner's and an administrator's, and the server refuses anybody else.

   The Coming soon page it replaces is gone: the service is built. */
export const routes = (
  <Route
    path="/h/:code/crs-bookings"
    element={
      <RequireAccess path="/h/:code/crs-bookings" resource="reservation">
        <PropertyScope /><CrsBookingsPage />
      </RequireAccess>
    }
  />
);
