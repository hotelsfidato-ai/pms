import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import PurchasingPage from "@/modules/purchasing/pages/Purchasing";
import PurchaseRequestPage from "@/modules/purchasing/pages/PurchaseRequest";
import WhoMayAskPage from "@/modules/purchasing/pages/WhoMayAsk";

/* Purchasing's three addresses. Mounted by App.tsx inside the signed-in
   shell.

   GUARDED, all three. The guard asks the navigation (`mayReach`), so a page
   is refused to exactly the people the menu does not show it to; the server
   refuses them as well, which is the half that matters (the Store's STO-1 is
   what a hidden-but-open screen looks like).

   `who-may-ask` sits BEFORE `:id` — otherwise react-router matches it as a
   request whose id is the words "who-may-ask", and the setting screen becomes
   a 404 nobody can explain. */
export const routes = (
  <>
    <Route
      path="/h/:code/purchasing"
      element={
        <RequireAccess path="/h/:code/purchasing" resource="purchasing">
          <PropertyScope /><PurchasingPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/purchasing/who-may-ask"
      element={
        <RequireAccess path="/h/:code/purchasing/who-may-ask" resource="purchasing">
          <PropertyScope /><WhoMayAskPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/purchasing/:id"
      element={
        <RequireAccess path="/h/:code/purchasing" resource="purchasing">
          <PropertyScope /><PurchaseRequestPage />
        </RequireAccess>
      }
    />
  </>
);
