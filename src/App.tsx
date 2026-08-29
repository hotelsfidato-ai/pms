import { useEffect, useRef } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useParams,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
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
  RoomTypesPage, RatePlansPage,
} from "@/pages/Directory";
import {
  UsersPage, RolesPage, AuditLogPage, IntegrationsPage,
  SettingsPage, AdminPropertiesPage,
} from "@/pages/admin/Admin";
import ReservationsPage from "@/pages/Reservations";
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
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
  },
});

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
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    restore();
  }, [restore]);

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
const PROPERTY: Array<[segment: string, title: string, carries: string, cp: string]> = [
  ["cashiering", "Cashiering", "unspecified — placeholder until the live flow is observed", "—"],
  /* POS left this list when the bridge got an interface. Its note said
     "Sattva is live in eZee today, so this is a migration" — still true
     of the TILL, and no longer true of the boundary it posts across. */
];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignInRoute />} />

          <Route element={<RequireSession />}>
            {/* Group level */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
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
            <Route path="/guests" element={<GuestsPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />

            <Route
              path="/admin/properties"
              element={
                <RequireAccess path="/admin/properties" resource="hotel">
                  <AdminPropertiesPage />
                </RequireAccess>
              }
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
            <Route
              path="/h/:code/stay"
              element={<><PropertyScope /><StayViewPage /></>}
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
              element={<><PropertyScope /><RoomTypesPage /></>}
            />
            <Route
              path="/h/:code/rate-plans"
              element={<><PropertyScope /><RatePlansPage /></>}
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}