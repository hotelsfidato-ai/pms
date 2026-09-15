import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation,
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
import { useUi } from "@/lib/ui";
import { useSession, useRole } from "@/lib/session";
import { homePath } from "@/lib/homeScreen";
import { workingHomeFor } from "@/components/app/navigation";
import { PropertyScope, PropertyIndex } from "@/components/app/PropertyScope";
import { NotificationsPage } from "@/pages/Directory";
import SignInPage from "@/pages/SignIn";
import DesignSystemPage from "@/pages/DesignSystem";
import PlaceholderPage from "@/pages/Placeholder";
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

            {/* What belongs to no service. */}
            {/* Hiding it in the nav is not removing it: the route would
                still resolve for anyone who typed the path, and the page
                would still be in the bundle. */}
            {import.meta.env.DEV && (
              <Route path="/design-system" element={<DesignSystemPage />} />
            )}
            <Route path="/notifications" element={<NotificationsPage />} />

            {/* Property level */}
            <Route
              path="/h/:code"
              element={<><PropertyScope /><PropertyIndex /></>}
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