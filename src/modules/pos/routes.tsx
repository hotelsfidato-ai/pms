import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import { PosGate } from "@/modules/pos/components/PosGate";
import TillPage from "@/modules/pos/pages/Till";
import FloorPage from "@/modules/pos/pages/Floor";
import MenuPage from "@/modules/pos/pages/Menu";
import DayEndPage from "@/modules/pos/pages/DayEnd";
import KitchenPage from "@/modules/pos/pages/Kitchen";
import TerminalPage from "@/modules/pos/pages/Terminal";
import BillPage from "@/modules/pos/pages/Bill";
import PosPage from "@/modules/pos/pages/Pos";
import SetupPage from "@/modules/pos/pages/Setup";
import TableBookingsPage from "@/modules/pos/pages/TableBookings";

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
    {/* Hotel guests' table requests, answered here (D27-224). */}
    <Route
      path="/h/:code/table-bookings"
      element={<><PropertyScope /><PosGate><TableBookingsPage /></PosGate></>}
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
    {/* Restaurant setup (D22-6): the owner, an administrator and the GM,
        asked of the menu entry itself; the server asks the same. */}
    <Route
      path="/h/:code/till/setup"
      element={
        <RequireAccess path="/h/:code/till/setup" resource="room_config">
          <PropertyScope /><PosGate><SetupPage /></PosGate>
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/till/terminal"
      element={<><PropertyScope /><PosGate><TerminalPage /></PosGate></>}
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
