import { Navigate, Route, useLocation, useParams } from "react-router";
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
   signed-in shell.

   ⚠ THE RESTAURANT'S OWN SPACE SINCE 3 OCTOBER (D27-249): /pos/:code/...,
   with its own menu. Every /h/:code/... address it had redirects (OLD, at
   the foot), its question and its bill id kept: a bookmark, a printed QR,
   the bell's links. A menu entry and its route move together (nav.ts). */

/** An old address, sent on to its new one with the hotel, id and question. */
function Moved({ to }: { to: string }) {
  const { code = "", id = "" } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${to.replace(":code", code).replace(":id", id)}${search}${hash}`} replace />;
}

const OLD: Array<[from: string, to: string]> = [
  ["/h/:code/floor", "/pos/:code/tables"],
  ["/h/:code/table-bookings", "/pos/:code/table-bookings"],
  ["/h/:code/menu", "/pos/:code/menu"],
  ["/h/:code/till", "/pos/:code/till"],
  ["/h/:code/till/day-end", "/pos/:code/day-end"],
  ["/h/:code/kitchen", "/pos/:code/kitchen"],
  ["/h/:code/till/setup", "/pos/:code/setup"],
  ["/h/:code/till/terminal", "/pos/:code/terminal"],
  ["/h/:code/till/bill/:id", "/pos/:code/bill/:id"],
  ["/h/:code/pos", "/pos/:code/room-charges"],
];

export const routes = (
  <>
    {/* The till writes; /pos reads what an outside one sent. */}
    <Route
      path="/pos/:code/till"
      element={<><PropertyScope /><PosGate><TillPage /></PosGate></>}
    />
    {/* The room, before the bill. A waiter opens an order by
        tapping a table, not by typing its name. */}
    <Route
      path="/pos/:code/tables"
      element={<><PropertyScope /><PosGate><FloorPage /></PosGate></>}
    />
    {/* Hotel guests' table requests, answered here (D27-224). */}
    <Route
      path="/pos/:code/table-bookings"
      element={<><PropertyScope /><PosGate><TableBookingsPage /></PosGate></>}
    />
    <Route
      path="/pos/:code/menu"
      element={<><PropertyScope /><PosGate><MenuPage /></PosGate></>}
    />
    {/* Before /till/bill/:id and /till/orders/:id — a literal
        segment beats a parameter, but the order makes it read
        that way to a person too. */}
    <Route
      path="/pos/:code/day-end"
      element={<><PropertyScope /><PosGate><DayEndPage /></PosGate></>}
    />
    {/* Before /till/bill/:id, and both before /till itself —
        react-router picks the most specific, but keeping them in
        this order makes the intent readable. */}
    <Route
      path="/pos/:code/kitchen"
      element={<><PropertyScope /><PosGate><KitchenPage /></PosGate></>}
    />
    {/* Restaurant setup (D22-6): the owner, an administrator and the GM,
        asked of the menu entry itself; the server asks the same. */}
    <Route
      path="/pos/:code/setup"
      element={
        <RequireAccess path="/pos/:code/setup" resource="room_config">
          <PropertyScope /><PosGate><SetupPage /></PosGate>
        </RequireAccess>
      }
    />
    <Route
      path="/pos/:code/terminal"
      element={<><PropertyScope /><PosGate><TerminalPage /></PosGate></>}
    />
    <Route
      path="/pos/:code/bill/:id"
      element={<><PropertyScope /><BillPage /></>}
    />
    <Route
      path="/pos/:code/room-charges"
      element={<><PropertyScope /><PosPage /></>}
    />
    {OLD.map(([from, to]) => <Route key={from} path={from} element={<Moved to={to} />} />)}
  </>
);
