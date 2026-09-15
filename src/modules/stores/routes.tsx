import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import StoresPage from "@/pages/Stores";

/* The store's screen address. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    {/* What the property keeps, and where it went. */}
    <Route
      path="/h/:code/stores"
      element={<><PropertyScope /><StoresPage /></>}
    />
  </>
);
