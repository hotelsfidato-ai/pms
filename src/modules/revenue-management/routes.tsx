import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import OutlookPage from "@/modules/revenue-management/pages/Outlook";

/* Revenue management's one address. Mounted by App.tsx inside the signed-in
   shell.

   GUARDED, like Pricing and the Rate calendar beside it. The guard asks the
   navigation (`mayReach`), so the entry in `nav.ts` and this page can never
   disagree about who gets in - and an entry the navigation has never heard
   of is reachable by ANYBODY, which is why the two land together. */
export const routes = (
  <Route
    path="/h/:code/revenue-outlook"
    element={
      <RequireAccess path="/h/:code/revenue-outlook" resource="rate">
        <PropertyScope /><OutlookPage />
      </RequireAccess>
    }
  />
);
