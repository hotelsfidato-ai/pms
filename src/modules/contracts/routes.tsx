import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import ContractsPage from "@/modules/contracts/pages/Contracts";
import CompanyContractsPage from "@/modules/contracts/pages/CompanyContracts";

/* Contracts' addresses (D27-184). Mounted by App.tsx inside the signed-in
   shell. Each guard asks the navigation (`mayReach`), so a page is refused
   to exactly the people the menu does not show it to; one company's page
   asks as the list does - it is the same screen, opened on one company. */
export const routes = (
  <>
    <Route path="/contracts" element={
      <RequireAccess path="/contracts" resource="company"><ContractsPage /></RequireAccess>
    } />
    <Route path="/contracts/:companyId" element={
      <RequireAccess path="/contracts" resource="company"><CompanyContractsPage /></RequireAccess>
    } />
  </>
);
