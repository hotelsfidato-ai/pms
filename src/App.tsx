import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter, HashRouter, Routes, Route, Navigate, useParams, useLocation,
} from "react-router";

/* Hash routing belongs to the SINGLE-FILE build, not to demo data.
   That file is opened with no server and no rewrite rule, so a path
   route 404s the moment anybody reloads or deep-links, and a hash
   route cannot because the server never sees it.

   Firebase Hosting rewrites every path to index.html, so the build
   that goes there keeps real paths — which are the URLs a client will
   bookmark. Keying this to DEMO instead put a hash on the hosted
   build too, and only clicking a nav link showed it. */
const Router = import.meta.env.VITE_SINGLE_FILE === "1"
  ? HashRouter
  : BrowserRouter;
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryPersister } from "@/lib/persist";
import { AppShell } from "@/components/app/AppShell";
import { PosGate } from "@/components/app/PosGate";
import { useUi } from "@/lib/ui";
import { useSession, useRole } from "@/lib/session";
import { homePath } from "@/lib/homeScreen";
import { workingHomeFor } from "@/components/app/navigation";
import DashboardPage from "@/pages/Dashboard";
import StayViewPage from "@/pages/StayView";
import HousekeepingPage from "@/pages/Housekeeping";
import ArrivalsPage from "@/pages/Arrivals";
import InHousePage from "@/pages/InHouse";
import FoliosPage from "@/pages/Folios";
import ManagerReportPage from "@/pages/reports/ManagerReport";
import {
  MonthlyOccupancyPage, MonthlyStatisticsPage, YearlyStatisticsPage,
} from "@/pages/reports/Statistics";
import {
  CityLedgerPage, NoShowPage, LodgingTaxPage,
} from "@/pages/reports/Ledgers";
import ReportsIndexPage from "@/pages/reports/Index";
import {
  GuestsPage, CompaniesPage, PropertiesPage, NotificationsPage,

} from "@/pages/Directory";
import {
  UsersPage, RolesPage, AuditLogPage, IntegrationsPage,
  SettingsPage,
} from "@/pages/admin/Admin";
import ReservationsPage from "@/pages/Reservations";
import TillPage from "@/pages/Till";
import FloorPage from "@/pages/Floor";
import DocketPage from "@/pages/Docket";
import DayEndPage from "@/pages/DayEnd";
import GridsPage from "@/pages/Grids";
import GroupPanelPage from "@/pages/GroupPanel";
import GroupsPage from "@/pages/Groups";
import NewBookingPage from "@/pages/NewBooking";
import WorkOrdersPage from "@/pages/WorkOrders";
import BanquetPage from "@/pages/Banquet";
import RoomSetupPage from "@/pages/RoomSetup";
import BookingSourcesPage from "@/pages/BookingSources";
import PropertyPage from "@/pages/Property";
import PeoplePage from "@/pages/People";
import ChannelManagerPage from "@/pages/ChannelManager";
import StoresPage from "@/pages/Stores";
import BanquetEventPage from "@/pages/BanquetEvent";
import BanquetSetupPage from "@/pages/BanquetSetup";
import CashieringPage from "@/pages/Cashiering";
import BillPage from "@/pages/Bill";
import MenuPage from "@/pages/Menu";
import RatePlansEditor from "@/pages/RatePlans";
import CancellationTermsPage from "@/pages/CancellationTerms";
import TerminalPage from "@/pages/Terminal";
import KitchenPage from "@/pages/Kitchen";
import AdminConsolePage from "@/pages/admin/Console";
import { IS_DEV } from "@/components/app/navigation";
import {
  PaymentsPage, PropertyCityLedgerPage,
} from "@/pages/Billing";
/* Invoices moved out of Billing.tsx when issuing landed. Three screens
   in one file was already a stretch; a fourth with a mutation in it
   was not. */
import InvoicesPage from "@/pages/Invoices";
import FormCPage from "@/pages/FormC";
import InvoicePage from "@/pages/Invoice";
import PosPage from "@/pages/Pos";
import { RequireAccess } from "@/components/app/RequireAccess";
import {
  GuestLedgerPage, CashierShiftPage, GstSalesPage, CFormPage,
} from "@/pages/reports/Compliance";
import RatesPage from "@/pages/Rates";
import NightAuditPage from "@/pages/NightAudit";
import WalkInsPage from "@/pages/WalkIns";
import SignInPage from "@/pages/SignIn";
import DesignSystemPage from "@/pages/DesignSystem";
import PlaceholderPage from "@/pages/Placeholder";

/* ══════════════════════════════════════════════════════════════════
   ROUTES — per PHASE-1-FRONTEND §1.2

     /                      group dashboard
     /h/:code/stay          the tape chart
     /h/:code/stay?res=…    same chart, detail panel open

   The property is in the URL, not only in a store, so a stay is
   linkable and switching property preserves the task. There is one
   property today; nothing here assumes that.
   ══════════════════════════════════════════════════════════════════ */

const queryClient = new QueryClient({
  defaultOptions: {
    /* Stage 1 has no network, so retries and refetching are noise. The
       client exists because Rule 5 lives in its keys. */
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      /* KEPT FOR A WEEK, so a screen opened with no connection has
         something to show. Without this the cache is memory-only and a
         reload offline is a blank application — which is what the
         housekeeper on a stairwell landing actually gets today.

         A week rather than forever: data older than that is more
         likely to mislead than to help, and the age is shown anyway. */
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
});

/* Read once when a screen opens with no connection. Anything not named
   here is fetched or absent — never silently stale.

   The rule for adding to this list: would a person be misled by seeing
   this from an hour ago, without being told? If yes, it does not go in. */
const PERSISTED = new Set([
  "properties", "property", "rooms",
  "arrivals", "in-house", "departures",
  "tape-chart", "floor", "housekeeping",
  "work-orders", "banquet-diary", "banquet-setup",
  /* THE MENU, so the order pad opens on a floor with no signal — which
     is the hill-station case this whole feature exists for. 1.2 KB
     gzipped, and it changes a few times a season.

     It passes the test above: a menu an hour old shows a dish that has
     since been taken off, the waiter taps it, and THE SERVER REFUSES IT
     WITH A REASON. That is Rule 6 working, not a person being misled.

     `till-rooms` IS here, and that was a decision rather than an
     oversight. It carries guest names and room numbers onto a waiter's
     own phone, which the rest of this list was not reasoned about for.
     The owner weighed that on 8 September and chose it: a waiter must be
     able to charge a dinner to a room with the line down, and they
     cannot pick a room from a list they cannot see.

     What makes it survivable is that the list is SMALL, changes daily,
     and is already visible to anybody standing at the till. What it is
     not is a guest database — no documents, no folios, no history. Those
     stay off the device, and the reason above still holds for them. */
  "till-menu",
  "till-rooms",
]);

/**
 * Nothing renders until the session has been settled one way or the
 * other. Rendering the shell first and redirecting after would flash a
 * signed-in interface at someone who is not signed in.
 */
/**
 * The sign-in screen, and the way back off it.
 *
 * Without this a successful sign-in leaves the person staring at the
 * form they just completed — the session changed and nothing moved,
 * which reads as a failure even though it worked.
 */
function SignInRoute() {
  const status = useSession((s) => s.status);
  if (status === "signed-in") return <Navigate to="/" replace />;
  return <SignInPage />;
}

function RequireSession() {
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const scope = useSession((s) => s.scope);
  const role = useRole();
  const hotels = useSession((s) => s.hotels);
  const sessionHotelId = useSession((s) => s.hotelId);
  const uiHotel = useUi((s) => s.hotelId);
  const location = useLocation();
  const started = useRef(false);
  /* ONCE PER ARRIVAL. The first screen is where somebody lands when they
     sign in or open the app — not where "/" goes every time. Clicking
     Dashboard in the menu must still reach the Dashboard.

     ⚠ STATE, SET AFTER THE FACT — NOT A REF MUTATED WHILE RENDERING. The
     first version set `landed.current = true` inside render. React's
     development double render then ran it twice: the first pass
     returned the redirect and marked itself landed, the second saw
     "landed" and returned the Dashboard — and the second is the one
     React keeps. Signing in as somebody set to start on Rooms opened the
     Dashboard. Render now only decides; the effect records it. */
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    restore();
  }, [restore]);

  useEffect(() => {
    if (status === "signed-in") setLanded(true);
  }, [status]);

  if (status === "signed-in" && !landed && location.pathname === "/") {
    /* The property in view, or the first this person may work in. */
    const code = uiHotel
      ?? hotels.find((h) => h.id === sessionHotelId)?.code
      ?? null;
    const to = homePath(scope?.homeScreen, code);
    if (to !== "/") return <Navigate to={to} replace />;
    /* Housekeeping, the kitchen, the restaurant floor and the stores have no
       Dashboard in their menu (owner, 15 September) — it carries revenue,
       and their day starts at their own work. So their first screen is the
       top of their own list, unless they chose one themselves. */
    const work = code ? workingHomeFor(role, code) : null;
    if (work) return <Navigate to={work} replace />;
  }

  if (status === "starting") {
    return (
      <div
        className="min-h-dvh grid place-items-center bg-grey-50"
        role="status"
        aria-live="polite"
      >
        <p className="text-base text-grey-500">Checking your session…</p>
      </div>
    );
  }

  if (status === "signed-out") return <Navigate to="/signin" replace />;

  return <AppShell />;
}

/** Keeps the store in step with the property named in the URL. */
function PropertyScope() {
  const { code } = useParams();
  const setHotelId = useUi((s) => s.setHotelId);
  useEffect(() => {
    if (code) setHotelId(code);
  }, [code, setHotelId]);
  return null;
}

/** Sends a bare `/h/:code` to that property's stay view. */
function PropertyIndex() {
  const { code } = useParams();
  return <Navigate to={`/h/${code}/stay`} replace />;
}

/* What is left unbuilt, and honestly labelled.

   Cashiering and POS are not placeholders for want of time. Neither
   has been specified: Sattva runs live in eZee today, so POS here is
   a migration off a working system rather than a new build, and
   guessing at either would put a screen in front of someone that
   contradicts what they use every day.                             */
/* EMPTY, AND THAT IS THE POINT. Every route in the application now has a
   screen behind it.

   Cashiering was the last entry and its note said why it was here:
   "unspecified — placeholder until the live flow is observed". It has now
   been observed — a front-desk shift close — and it is built.

   The machinery stays because the next unobserved thing belongs here rather
   than as a route that renders nothing. */
const PROPERTY: Array<[segment: string, title: string, carries: string, cp: string]> = [];

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        /* ⚠ THROWN AWAY WHEN THE BUILD CHANGES. A week is the right
           life for the DATA and the wrong life for its SHAPE: a browser
           holding a menu from before `prepMinutes` existed rendered
           "undefined min" on the menu screen, because a persisted
           response outlived the code that produced it.
           Set per build in `vite.config.ts`, fixed in development. */
        buster: __CACHE_BUSTER__,
        /* WHAT IS WRITTEN TO DISK, and this list is a privacy decision
           as much as a technical one. A shared front-desk machine keeps
           this cache after the clerk walks away, so only what a screen
           needs in order to open offline is kept — the floor, today's
           movements, the rooms. Guest documents, folios and reports are
           NOT persisted: a passport scan does not belong in a browser
           store on a machine four people use. */
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const key = String(query.queryKey[0] ?? "");
            return PERSISTED.has(key);
          },
        },
      }}
    >
      <Router>
        <Routes>
          <Route path="/signin" element={<SignInRoute />} />

          <Route element={<RequireSession />}>
            {/* Group level */}
            <Route path="/" element={<DashboardPage />} />
            {/* Hiding it in the nav is not removing it: the route would
                still resolve for anyone who typed the path, and the page
                would still be in the bundle. */}
            {import.meta.env.DEV && (
              <Route path="/design-system" element={<DesignSystemPage />} />
            )}
            <Route path="/reports/manager" element={<ManagerReportPage />} />
            <Route path="/reports/city-ledger" element={<CityLedgerPage />} />
            <Route path="/reports/no-show" element={<NoShowPage />} />
            <Route path="/reports/monthly-occupancy" element={<MonthlyOccupancyPage />} />
            <Route path="/reports/monthly-stats" element={<MonthlyStatisticsPage />} />
            <Route path="/reports/yearly-stats" element={<YearlyStatisticsPage />} />
            <Route path="/reports/lodging-tax" element={<LodgingTaxPage />} />
            <Route path="/reports/guest-ledger" element={<GuestLedgerPage />} />
            <Route path="/reports/cashier-shift" element={<CashierShiftPage />} />
            <Route path="/reports/gst-sales" element={<GstSalesPage />} />
            <Route path="/reports/c-form" element={<CFormPage />} />
            <Route path="/reports" element={<ReportsIndexPage />} />

            <Route path="/properties" element={<PropertiesPage />} />
            {/* One property: its own numbers, and the people who work
                there. Scoped by hotel rather than by rank — a general
                manager gets this for theirs and a 404 for anybody
                else's, because it carries the GSTIN. */}
            <Route path="/properties/:code" element={<PropertyPage />} />
            <Route path="/guests" element={<GuestsPage />} />
            {/* NOT development-gated. The endpoints behind it have
                existed since the admin work and were reachable only from
                a dev-only console, so the owner -- the one person who
                actually has staff to add -- could not reach them. */}
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />

            <Route
              /* ⚠ A REDIRECT, NOT A SECOND COPY OF THE SCREEN. There
                 were two Properties screens and they were merged on
                 9 September; pointing this route at `PropertiesPage`
                 left an /admin path whose only authorisation lived in
                 a navigation entry — and removing that entry to fix a
                 duplicate label silently opened it, because
                 `mayReach` returns TRUE for a path the navigation does
                 not contain. The guard fails OPEN.

                 A redirect has nothing to fail. The old link still
                 works, and it lands on the screen that answers for its
                 own access. */
              path="/admin/properties"
              element={<Navigate to="/properties" replace />}
            />
            <Route
              path="/admin/users"
              element={
                <RequireAccess path="/admin/users" resource="user">
                  <UsersPage />
                </RequireAccess>
              }
            />
            <Route
              path="/admin/roles"
              element={
                <RequireAccess path="/admin/roles" resource="role">
                  <RolesPage />
                </RequireAccess>
              }
            />
            <Route
              path="/admin/audit-log"
              element={
                <RequireAccess path="/admin/audit-log" resource="audit_log">
                  <AuditLogPage />
                </RequireAccess>
              }
            />
            <Route
              path="/admin/integrations"
              element={
                <RequireAccess path="/admin/integrations" resource="integration">
                  <IntegrationsPage />
                </RequireAccess>
              }
            />
            {/* The console is gated on the ROUTE, not only in the
                navigation. Hiding a link has never been access control —
                that lesson cost a defect earlier in this build, when a
                clerk could type /admin/users and get the page. In a
                production build this route does not exist at all, so
                there is nothing to type. */}
            {IS_DEV && (
              <Route
                path="/admin/console"
                element={
                  <RequireAccess path="/admin/console" resource="hotel">
                    <AdminConsolePage />
                  </RequireAccess>
                }
              />
            )}
            <Route
              path="/admin/settings"
              element={
                <RequireAccess path="/admin/settings" resource="setting">
                  <SettingsPage />
                </RequireAccess>
              }
            />

            {/* Property level */}
            <Route
              path="/h/:code"
              element={<><PropertyScope /><PropertyIndex /></>}
            />
            {/* ROOMS AND CALENDAR ARE TWO SCREENS (14 September). They
                were one address with a toggle, and the menu's "Calendar"
                link opened it on Rooms. `/stay` stays Rooms, because every
                deep link to a booking (?res=) already points there. */}
            <Route
              path="/h/:code/stay"
              element={<><PropertyScope /><StayViewPage view="floor" /></>}
            />
            <Route
              path="/h/:code/calendar"
              element={<><PropertyScope /><StayViewPage view="calendar" /></>}
            />
            <Route
              path="/h/:code/housekeeping"
              element={<><PropertyScope /><HousekeepingPage /></>}
            />
            <Route
              path="/h/:code/arrivals"
              element={<><PropertyScope /><ArrivalsPage /></>}
            />
            <Route
              path="/h/:code/arrivals/upcoming"
              element={<><PropertyScope /><ArrivalsPage /></>}
            />
            <Route
              path="/h/:code/in-house"
              element={<><PropertyScope /><InHousePage /></>}
            />
            <Route
              path="/h/:code/in-house/due-out"
              element={<><PropertyScope /><InHousePage /></>}
            />
            <Route
              path="/h/:code/folios"
              element={<><PropertyScope /><FoliosPage /></>}
            />
            <Route
              path="/h/:code/reservations"
              element={<><PropertyScope /><ReservationsPage /></>}
            />
            <Route
              path="/h/:code/walk-ins"
              element={<><PropertyScope /><WalkInsPage /></>}
            />
            <Route
              path="/h/:code/room-types"
              element={<><PropertyScope /><RoomSetupPage /></>}
            />
            {/* Named rather than omitted. The largest gap in the product,
                and a navigation that says nothing about it leaves somebody
                hunting for a screen that does not exist. Rule 6 applies to
                features as well as buttons. */}
            {/* What the property keeps, and where it went. */}
            <Route
              path="/h/:code/stores"
              element={<><PropertyScope /><StoresPage /></>}
            />
            <Route
              path="/h/:code/channels"
              element={<><PropertyScope /><ChannelManagerPage /></>}
            />
            <Route
              path="/h/:code/rate-plans"
              element={<><PropertyScope /><RatePlansEditor /></>}
            />
            <Route
              path="/h/:code/cancellation-terms"
              element={<><PropertyScope /><CancellationTermsPage /></>}
            />
            {/* Where a booking came from. The list is the group's, the
                commission is this property's — the screen says so. */}
            <Route
              path="/h/:code/booking-sources"
              element={<><PropertyScope /><BookingSourcesPage /></>}
            />
            <Route
              path="/h/:code/rates"
              element={<><PropertyScope /><RatesPage /></>}
            />
            <Route
              path="/h/:code/payments"
              element={<><PropertyScope /><PaymentsPage /></>}
            />
            <Route
              path="/h/:code/invoices"
              element={<><PropertyScope /><InvoicesPage /></>}
            />
            <Route
              path="/h/:code/form-c"
              element={<><PropertyScope /><FormCPage /></>}
            />
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
            {/* The revenue manager's day: how many rooms are left, and
                what they cost. One window, two tabs, because the two
                questions are asked together. */}
            <Route
              path="/h/:code/grids"
              element={<><PropertyScope /><GridsPage /></>}
            />
            {/* One guest, one set of nights, as many rooms as they need. */}
            <Route
              path="/h/:code/book"
              element={<><PropertyScope /><NewBookingPage /></>}
            />
            {/* The front desk drawer: open with a float, take receipts,
                count, hand over. */}
            <Route
              path="/h/:code/cashiering"
              element={<><PropertyScope /><CashieringPage /></>}
            />
            {/* What needs fixing. Not the same as a room being out. */}
            <Route
              path="/h/:code/work-orders"
              element={<><PropertyScope /><WorkOrdersPage /></>}
            />
            {/* The banquet diary. The hall is the row, because the
                question asked of this screen is "is it free on the
                fourteenth" and not "list the bookings". */}
            <Route
              path="/h/:code/banquet"
              element={<><PropertyScope /><BanquetPage /></>}
            />
            {/* Before /banquet/:id — a literal segment outranks a
                parameter either way, but the order says so. */}
            <Route
              path="/h/:code/banquet/setup"
              element={<><PropertyScope /><BanquetSetupPage /></>}
            />
            <Route
              path="/h/:code/banquet/:id"
              element={<><PropertyScope /><BanquetEventPage /></>}
            />
            {/* The LIST. The panel below has existed since 056 and could
                be reached only by somebody who already knew a group's
                id — no list, no navigation entry, no way in. Before the
                parameterised route, so a literal segment cannot be
                swallowed by an :id. */}
            <Route
              path="/h/:code/groups"
              element={<><PropertyScope /><GroupsPage /></>}
            />
            {/* One group: its rooms, and who pays for which. */}
            <Route
              path="/h/:code/groups/:id"
              element={<><PropertyScope /><GroupPanelPage /></>}
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
            {/* An invoice number contains slashes — 5EL/2026-27/00001 — so
                the segment has to swallow them. `*` after the param is how
                react-router spells "the rest of the path". */}
            <Route
              path="/h/:code/invoices/doc/*"
              element={<><PropertyScope /><InvoicePage /></>}
            />
            <Route
              path="/h/:code/city-ledger"
              element={<><PropertyScope /><PropertyCityLedgerPage /></>}
            />
            <Route
              path="/h/:code/night-audit"
              element={<><PropertyScope /><NightAuditPage /></>}
            />
            {PROPERTY.map(([segment, title, carries, cp]) => (
              <Route
                key={segment}
                path={`/h/:code/${segment}`}
                element={
                  <>
                    <PropertyScope />
                    <PlaceholderPage title={title} carries={carries} checkpoint={cp} />
                  </>
                }
              />
            ))}

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </PersistQueryClientProvider>
  );
}