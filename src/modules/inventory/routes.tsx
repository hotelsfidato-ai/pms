import { Navigate, Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";
import CancellationTermsPage from "@/modules/inventory/pages/CancellationTerms";
import RatesPage from "@/modules/inventory/pages/Rates";

/* Inventory and rates' screen addresses. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/room-types"
      element={<><PropertyScope /><RoomSetupPage /></>}
    />
    <Route
      path="/h/:code/cancellation-terms"
      element={<><PropertyScope /><CancellationTermsPage /></>}
    />
    {/* D27-188, D27-194: one Rates screen - the setup, each day's price and
        how it sold, rooms left and restrictions. Everyone who reads prices
        sees it; only the rate setters change anything (the screen asks
        setsRates, and every write route asks the gate). */}
    <Route
      path="/h/:code/rates"
      element={<><PropertyScope /><RatesPage /></>}
    />
    {/* The four screens it replaced: their addresses open it. */}
    <Route path="/h/:code/grids" element={<Navigate to="../rates" relative="path" replace />} />
    <Route path="/h/:code/pricing" element={<Navigate to="../rates" relative="path" replace />} />
    <Route path="/h/:code/rate-plans" element={<Navigate to="../rates" relative="path" replace />} />
  </>
);
