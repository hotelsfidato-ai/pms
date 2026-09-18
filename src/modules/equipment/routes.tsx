import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import EquipmentRegisterPage from "@/modules/equipment/pages/EquipmentRegister";
import EquipmentItemPage from "@/modules/equipment/pages/EquipmentItem";

/* Equipment's screen addresses. Mounted by App.tsx inside the signed-in
   shell.

   GUARDED, both of them. The guard asks the navigation (`mayReach`), so
   the page is refused to exactly the people the menu does not show it to
   — the revenue manager and the till operator. A hidden menu entry is not
   a closed door (the Store's STO-1 is what that looks like); the server
   refuses them as well (api/test/modules/equipment/grants.test.ts). */
export const routes = (
  <>
    <Route
      path="/h/:code/equipment"
      element={
        <RequireAccess path="/h/:code/equipment" resource="equipment">
          <PropertyScope /><EquipmentRegisterPage />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/equipment/:id"
      element={
        <RequireAccess path="/h/:code/equipment" resource="equipment">
          <PropertyScope /><EquipmentItemPage />
        </RequireAccess>
      }
    />
  </>
);
