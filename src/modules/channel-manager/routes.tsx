import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import ChannelManagerPage from "@/modules/channel-manager/pages/ChannelManager";

/* The channel manager's status page — under Distribution, marked "Not built
   yet", since 28 September (D27-87; the Coming soon section from 16 September).
   Mounted by App.tsx inside the signed-in shell. Guarded like every page of a
   service not built yet: the guard asks the navigation, so the page is refused to
   exactly the people the menu does not show it to. */
export const routes = (
  <>
    {/* Named rather than omitted. The largest gap in the product,
        and a navigation that says nothing about it leaves somebody
        hunting for a screen that does not exist. Rule 6 applies to
        features as well as buttons. */}
    <Route
      path="/h/:code/channels"
      element={
        <>
          <PropertyScope />
          <RequireAccess path="/h/:code/channels" resource="integration">
            <ChannelManagerPage />
          </RequireAccess>
        </>
      }
    />
  </>
);
