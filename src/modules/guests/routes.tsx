import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { GuestsPage, CompaniesPage } from "@/modules/guests/pages/Guests";
import BookingSourcesPage from "@/modules/guests/pages/BookingSources";
import FormCPage from "@/modules/guests/pages/FormC";

/* Guests and companies' screen addresses. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    <Route path="/guests" element={<GuestsPage />} />
    <Route path="/companies" element={<CompaniesPage />} />
    {/* Where a booking came from. The list is the group's, the
        commission is this property's — the screen says so. */}
    <Route
      path="/h/:code/booking-sources"
      element={<><PropertyScope /><BookingSourcesPage /></>}
    />
    <Route
      path="/h/:code/form-c"
      element={<><PropertyScope /><FormCPage /></>}
    />
  </>
);
