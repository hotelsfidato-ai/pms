import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import { Guest360Page, Guest360SearchPage } from "@/modules/crm/pages/Guest360";
import SamePersonPage from "@/modules/crm/pages/SamePerson";

/* Central CRM's addresses, built 21 September (docs/briefs/crm.md). Each
   guard asks the navigation (`mayReach`), so a page is refused to exactly
   the people the menu hides it from: everybody but the owner, an
   administrator and the GM (D21-4). One guest's page asks as the search
   does - it is the same screen, opened on one person. */
export const routes = (
  <>
    <Route path="/crm/guests" element={
      <RequireAccess path="/crm/guests" resource="customer"><Guest360SearchPage /></RequireAccess>
    } />
    <Route path="/crm/guests/:id" element={
      <RequireAccess path="/crm/guests" resource="customer"><Guest360Page /></RequireAccess>
    } />
    <Route path="/crm/same-person" element={
      <RequireAccess path="/crm/same-person" resource="customer"><SamePersonPage /></RequireAccess>
    } />
  </>
);
