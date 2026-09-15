import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { PosGate } from "@/components/app/PosGate";
import TillPage from "@/pages/Till";
import FloorPage from "@/pages/Floor";
import MenuPage from "@/pages/Menu";
import DayEndPage from "@/pages/DayEnd";
import KitchenPage from "@/pages/Kitchen";
import TerminalPage from "@/pages/Terminal";
import DocketPage from "@/pages/Docket";
import BillPage from "@/pages/Bill";
import PosPage from "@/pages/Pos";

/* The restaurant's screen addresses. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    {/* The till writes; /pos reads what an outside one sent. */}
    <Route
      path="/h/:code/till"
      element={<><PropertyScope /><PosGate><TillPage /></PosGate></>}
    />
    {/* The room, before the bill. A waiter opens an order by
        tapping a table, not by typing its name. */}
    <Route
      path="/h/:code/floor"
      element={<><PropertyScope /><PosGate><FloorPage /></PosGate></>}
    />
    <Route
      path="/h/:code/menu"
      element={<><PropertyScope /><PosGate><MenuPage /></PosGate></>}
    />
    {/* Before /till/bill/:id and /till/orders/:id — a literal
        segment beats a parameter, but the order makes it read
        that way to a person too. */}
    <Route
      path="/h/:code/till/day-end"
      element={<><PropertyScope /><PosGate><DayEndPage /></PosGate></>}
    />
    {/* Before /till/bill/:id, and both before /till itself —
        react-router picks the most specific, but keeping them in
        this order makes the intent readable. */}
    <Route
      path="/h/:code/kitchen"
      element={<><PropertyScope /><PosGate><KitchenPage /></PosGate></>}
    />
    <Route
      path="/h/:code/till/terminal"
      element={<><PropertyScope /><PosGate><TerminalPage /></PosGate></>}
    />
    {/* The docket, before the bill route so :id does not
        swallow it. No prices on this one, ever. */}
    <Route
      path="/h/:code/till/orders/:id/kot/:no"
      element={<><PropertyScope /><DocketPage /></>}
    />
    <Route
      path="/h/:code/till/bill/:id"
      element={<><PropertyScope /><BillPage /></>}
    />
    <Route
      path="/h/:code/pos"
      element={<><PropertyScope /><PosPage /></>}
    />
  </>
);
