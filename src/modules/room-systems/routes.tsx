import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import RoomSystemsPage from "@/modules/room-systems/pages/RoomSystems";

/* Room systems' one address — its Coming soon page. Mounted by App.tsx inside
   the signed-in shell; the guard asks the navigation. */
export const routes = (
  <Route
    path="/coming-soon/room-systems"
    element={
      <RequireAccess path="/coming-soon/room-systems" resource="integration">
        <RoomSystemsPage />
      </RequireAccess>
    }
  />
);
