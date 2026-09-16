import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import PurchasingPage from "@/modules/purchasing/pages/Purchasing";

/* Purchasing's one address — its Coming soon page. Mounted by App.tsx inside
   the signed-in shell; the guard asks the navigation, so the page is refused
   to exactly the people the menu does not show it to. */
export const routes = (
  <Route
    path="/coming-soon/purchasing"
    element={
      <RequireAccess path="/coming-soon/purchasing" resource="integration">
        <PurchasingPage />
      </RequireAccess>
    }
  />
);
