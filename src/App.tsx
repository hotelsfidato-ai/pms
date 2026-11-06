import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useLocation,
} from "react-router";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryPersister } from "@/lib/persist";
import { AppShell } from "@/components/app/AppShell";
import { useUi } from "@/lib/ui";
import { useSession, useRole } from "@/lib/session";
import { homePath } from "@/lib/homeScreen";
import { workingHomeFor } from "@/components/app/navigation";
import { PropertyScope, PropertyIndex } from "@/components/app/PropertyScope";
import ApprovalsPage from "@/pages/Approvals";
import { RequireAccess } from "@/components/app/RequireAccess";
import { reCheckMoney } from "@/lib/freshness";
import { NotificationsPage } from "@/pages/Notifications";
import PlacesAndSuppliersPage from "@/pages/PlacesAndSuppliers";
import SignInPage from "@/pages/SignIn";
import { TwoStepGate } from "@/modules/admin";
import DesignSystemPage from "@/pages/DesignSystem";
/* Every service's screen addresses, from its own routes file
   (docs/SERVICE-FOLDERS-PLAN.md). */
import { routes as frontDeskRoutes } from "@/modules/front-desk/routes";
import { routes as reservationsRoutes } from "@/modules/reservations/routes";
import { routes as housekeepingRoutes } from "@/modules/housekeeping/routes";
import { routes as inventoryRoutes } from "@/modules/inventory/routes";
import { routes as guestsRoutes } from "@/modules/guests/routes";
import { routes as financeRoutes } from "@/modules/finance/routes";
import { routes as nightAuditRoutes } from "@/modules/night-audit/routes";
import { routes as posRoutes } from "@/modules/pos/routes";
import { routes as banquetRoutes } from "@/modules/banquet/routes";
import { routes as storesRoutes } from "@/modules/stores/routes";
import { routes as reportsRoutes } from "@/modules/reports/routes";
import { routes as adminRoutes } from "@/modules/admin/routes";
import { routes as channelManagerRoutes } from "@/modules/channel-manager/routes";
/* The services not built yet — each a Coming soon page (16 September),
   reached from its own section of the menu since 28 September (D27-87). */
import { routes as accountingRoutes } from "@/modules/accounting/routes";
import { routes as crmRoutes } from "@/modules/crm/routes";
import { routes as contractsRoutes } from "@/modules/contracts/routes";
import { routes as crsRoutes } from "@/modules/crs/routes";
import { routes as guestMessagingRoutes } from "@/modules/guest-messaging/routes";
import { routes as guestServicesRoutes } from "@/modules/guest-services/routes";
import { routes as equipmentRoutes } from "@/modules/equipment/routes";
import { routes as purchasingRoutes } from "@/modules/purchasing/routes";
import { routes as roomSystemsRoutes } from "@/modules/room-systems/routes";
import { routes as laundryRoutes } from "@/modules/laundry/routes";
import { routes as leadsRoutes } from "@/modules/leads/routes";
import { routes as loyaltyRoutes } from "@/modules/loyalty/routes";
import { routes as marketingRoutes } from "@/modules/marketing/routes";
import {
  routes as onlineCheckinRoutes, publicRoutes as guestPagePublicRoutes,
} from "@/modules/online-checkin/routes";
import { routes as paymentsRoutes } from "@/modules/payments/routes";
import { routes as revenueManagementRoutes } from "@/modules/revenue-management/routes";
import { routes as reputationRoutes } from "@/modules/reputation/routes";
import { routes as spaRoutes } from "@/modules/spa/routes";

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
/* Money is the exception: re-checked whenever a screen opens or comes back
   into view (FIN-3, the owner's D17-58). The list is src/lib/freshness.ts. */
reCheckMoney(queryClient);

/* Read once when a screen opens with no connection. Anything not named
   here is fetched or absent — never silently stale.

   The rule for adding to this list: would a person be misled by seeing
   this from an hour ago, without being told? If yes, it does not go in. */
const PERSISTED = new Set([
  "properties", "property", "rooms",
  "arrivals", "in-house", "departures",
  "stay-view", "floor", "housekeeping",
  "work-orders", "banquet-diary", "banquet-setup",
  /* `stay-view` IS THE ROOMS BOARD (D22-23; the owner, 24 September): its
     rooms, their states and the fortnight on screen, so a reload with the
     server down still shows the house. It was "tape-chart" here, which no
     query was ever called. The Calendar reads the same query, so its weeks
     come along. `stays` - the names under the tiles - is NOT here: it is
     the hotel's whole booking list, and the owner chose to keep that off
     the desk computer. */
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
  /* The numbered Add-ons (D27-289), with the menu and for the same reason:
     Customise on a floor with no signal. An add-on taken off since is
     refused by the server with a reason, as a dish is. */
  "till-addons",
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
/* BACK TO WHERE YOU WERE GOING (10 October, D27-299). A signed-out visit to
   /pos/AMR/setup#kot - the one-click KOT setup opens exactly that, in a new
   window - is sent to sign in carrying where it was going, and after signing
   in lands THERE, not on the Dashboard. Only a path inside this app is
   followed: one "/", never "//" (another site), never back to /signin. */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
    && !from.startsWith("/signin") ? from : "/";
}

function SignInRoute() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === "signed-in" || status === "two-step") {
    return <Navigate to={returnPath(location.state)} replace />;
  }
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

  if (status === "signed-out") {
    return <Navigate to="/signin" replace
                     state={{ from: location.pathname + location.search + location.hash }} />;
  }

  /* D27-396: the code from the authenticator app first, and nothing else. */
  if (status === "two-step") return <TwoStepGate />;

  return <AppShell />;
}

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
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignInRoute />} />
          {/* ⚠ THE GUEST'S OWN PAGE, OUTSIDE THE SESSION GATE — mounted 21
              September, two days after the guest-page chat asked for exactly
              this line, proved it, and reverted it because this file is the
              master's. Until then /g/:token fell through to the catch-all:
              the page was merged and NO GUEST COULD OPEN IT (root MEMORY 310).

              It is outside RequireSession on purpose. A guest has no sign-in
              and never will; the token in the address is the whole credential
              (migration 114), and everything behind the six-digit code is
              refused by the SERVER, not by this router. */}
          {guestPagePublicRoutes}

          <Route element={<RequireSession />}>
            {/* Each service's screens come from its own routes file
                (docs/SERVICE-FOLDERS-PLAN.md), so a service adding a
                screen never edits this one. Order does not matter:
                react-router ranks routes by how specific they are. */}
            {reportsRoutes}
            {adminRoutes}
            {guestsRoutes}
            {frontDeskRoutes}
            {housekeepingRoutes}
            {reservationsRoutes}
            {inventoryRoutes}
            {financeRoutes}
            {posRoutes}
            {banquetRoutes}
            {storesRoutes}
            {nightAuditRoutes}
            {channelManagerRoutes}
            {/* Coming soon: one page each for the services not built yet. */}
            {accountingRoutes}
            {crmRoutes}
            {contractsRoutes}
            {crsRoutes}
            {guestMessagingRoutes}
            {guestServicesRoutes}
            {equipmentRoutes}
            {purchasingRoutes}
            {roomSystemsRoutes}
            {laundryRoutes}
            {leadsRoutes}
            {loyaltyRoutes}
            {marketingRoutes}
            {onlineCheckinRoutes}
            {paymentsRoutes}
            {revenueManagementRoutes}
            {reputationRoutes}
            {spaRoutes}

            {/* What belongs to no service. */}
            {/* Hiding it in the nav is not removing it: the route would
                still resolve for anyone who typed the path, and the page
                would still be in the bundle. */}
            {import.meta.env.DEV && (
              <Route path="/design-system" element={<DesignSystemPage />} />
            )}
            <Route path="/notifications" element={<NotificationsPage />} />
            {/* Everything waiting on you, from every service (D18-19).
                Core, because the approvals engine spans them all. */}
            <Route
              path="/h/:code/approvals"
              element={
                <RequireAccess path="/h/:code/approvals" resource="notification">
                  <PropertyScope /><ApprovalsPage />
                </RequireAccess>
              }
            />
            {/* Places and suppliers: shared by the Store, equipment and
                purchasing, so core. Guarded like the Store. */}
            <Route
              path="/h/:code/places"
              element={
                <RequireAccess path="/h/:code/places" resource="stock">
                  <PropertyScope /><PlacesAndSuppliersPage />
                </RequireAccess>
              }
            />

            {/* Property level */}
            <Route
              path="/h/:code"
              element={<><PropertyScope /><PropertyIndex /></>}
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PersistQueryClientProvider>
  );
}