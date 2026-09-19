import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import SpaDiaryPage from "@/modules/spa/pages/SpaDiary";
import SpaSetupPage from "@/modules/spa/pages/SpaSetup";

/* The spa's two addresses. Mounted by App.tsx inside the signed-in shell.

   GUARDED, both. The guard asks the NAVIGATION (`mayReach`), so a page is
   refused to exactly the people the menu does not show it to — and the
   server refuses them again, which is the half that matters: it also
   refuses the property that has no spa at all.

   `/spa/setup` is a literal segment and the diary takes no id, so there is
   no parameter for it to be swallowed by. */
export const routes = (
  <>
    <Route
      path="/h/:code/spa"
      element={
        <RequireAccess path="/h/:code/spa" resource="spa">
          <PropertyScope /><SpaDiaryPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/spa/setup"
      element={
        <RequireAccess path="/h/:code/spa/setup" resource="spa">
          <PropertyScope /><SpaSetupPage />
        </RequireAccess>
      }
    />
  </>
);
