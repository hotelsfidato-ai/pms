import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import BanquetPage from "@/pages/Banquet";
import BanquetSetupPage from "@/pages/BanquetSetup";
import BanquetEventPage from "@/pages/BanquetEvent";

/* Banquet's screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    {/* The banquet diary. The hall is the row, because the
        question asked of this screen is "is it free on the
        fourteenth" and not "list the bookings". */}
    <Route
      path="/h/:code/banquet"
      element={<><PropertyScope /><BanquetPage /></>}
    />
    {/* Before /banquet/:id — a literal segment outranks a
        parameter either way, but the order says so. */}
    <Route
      path="/h/:code/banquet/setup"
      element={<><PropertyScope /><BanquetSetupPage /></>}
    />
    <Route
      path="/h/:code/banquet/:id"
      element={<><PropertyScope /><BanquetEventPage /></>}
    />
  </>
);
