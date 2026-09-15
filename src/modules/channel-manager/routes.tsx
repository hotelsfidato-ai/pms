import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import ChannelManagerPage from "@/pages/ChannelManager";

/* The channel manager's status page — parked by the owner. Mounted by
   App.tsx inside the signed-in shell. */
export const routes = (
  <>
    {/* Named rather than omitted. The largest gap in the product,
        and a navigation that says nothing about it leaves somebody
        hunting for a screen that does not exist. Rule 6 applies to
        features as well as buttons. */}
    <Route
      path="/h/:code/channels"
      element={<><PropertyScope /><ChannelManagerPage /></>}
    />
  </>
);
