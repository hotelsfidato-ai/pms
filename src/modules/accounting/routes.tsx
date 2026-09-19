import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import AccountingPage from "@/modules/accounting/pages/Accounting";

/* Accounting export's one address. Mounted by App.tsx inside the signed-in
   shell. The guard asks the navigation (`mayReach`), so the page is refused
   to exactly the people the menu does not show it to - the owner, an
   administrator and the GM see it, and a hotel manager holding `report` is
   turned away here as well as at the API.

   It was `/coming-soon/accounting` until 19 September, when the service was
   built. */
export const routes = (
  <Route
    path="/reports/accounting"
    element={
      <RequireAccess path="/reports/accounting" resource="report">
        <AccountingPage />
      </RequireAccess>
    }
  />
);
