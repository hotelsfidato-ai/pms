import { useEffect } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useParams,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { useUi } from "@/lib/ui";
import DashboardPage from "@/pages/Dashboard";
import StayViewPage from "@/pages/StayView";
import HousekeepingPage from "@/pages/Housekeeping";
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

/* Group-level routes. */
const GROUP: Array<[path: string, title: string, carries: string, cp: string]> = [
  ["/properties", "Properties", "the property list, read-only — adding one is under Administration", "CP6"],
  ["/guests", "Guests", "the guest database, with duplicates visible and a merge action", "CP5"],
  ["/companies", "Companies", "corporate accounts and their city-ledger balances", "CP6"],
  ["/reports/manager", "Manager Report", "Today, PTD and YTD across revenue, payments and three ledgers", "CP6"],
  ["/reports/city-ledger", "City Ledger report", "opening, debit, credit and closing per account", "CP6"],
  ["/reports/no-show", "No Show report", "no-shows for the business date — usually empty, and still prints", "CP6"],
  ["/reports/monthly-occupancy", "Monthly Occupancy", "occupancy percentage by day of month", "CP6"],
  ["/reports/monthly-stats", "Monthly Statistics", "daily grid: available, sold, ADR, RevPAR, pax, tax", "CP6"],
  ["/reports/yearly-stats", "Yearly Statistics", "the same grid by month, with grand total", "CP6"],
  ["/reports/lodging-tax", "Lodging Tax", "statutory Excel export with two-level CGST and SGST headers", "CP6"],
  ["/reports", "Reports", "the report taxonomy, favouritable", "CP6"],
  ["/admin/properties", "Properties", "add a property — one form, no infrastructure", "CP6"],
  ["/admin/users", "Users", "staff accounts and their property access", "CP6"],
  ["/admin/roles", "Roles & permissions", "the live permission matrix, from src/lib/permissions", "CP6"],
  ["/admin/audit-log", "Audit log", "who changed what, and when — append-only", "CP6"],
  ["/admin/integrations", "Integrations", "channel manager and POS connection status", "CP6"],
  ["/admin/settings", "Settings", "tax rates, check-in times, invoice series", "CP6"],
  ["/notifications", "Notifications", "arrivals, overdue balances and failed channel syncs", "CP6"],
];

/* Property-level routes, all under /h/:code/. */
const PROPERTY: Array<[segment: string, title: string, carries: string, cp: string]> = [
  ["arrivals", "Arrivals", "today's expected arrivals, with check-in from the row", "CP5"],
  ["arrivals/upcoming", "Upcoming arrivals", "the next fourteen days of expected arrivals", "CP5"],
  ["in-house", "In house", "every occupied room, with folio balance and departure date", "CP5"],
  ["in-house/due-out", "Due out", "rooms departing today, with balances still open", "CP5"],
  ["walk-ins", "Walk-ins", "walk-ins taken today — the flow itself starts from an empty cell in Stay View", "CP5"],
  ["room-types", "Room types", "Superior and Deluxe, with occupancy limits and rack rates", "CP6"],
  ["rate-plans", "Rate plans", "EP, CP and MAP, and what each includes", "CP6"],
  ["payments", "Payments", "receipts by method: cash, UPI, card, GoMMT, room posting", "CP6"],
  ["city-ledger", "City ledger", "Agoda, Booking.com, Expedia and go-MMT balances", "CP6"],
  ["reservations", "Reservations", "the full book — three tabs: arrivals, in house, departures", "CP5"],
  ["folios", "Folios", "open accounts, including overpayments and disputes", "CP5"],
  ["invoices", "Invoices", "issued invoices, with the Georgia print preview", "CP6"],
  ["rates", "Rates", "the rate grid, editable cells", "CP6"],
  ["night-audit", "Night audit", "run and log — posts once, twice-run is refused", "CP6"],
  ["cashiering", "Cashiering", "unspecified — placeholder until the live flow is observed", "—"],
  ["pos", "POS", "unspecified — Sattva is live in eZee today, so this is a migration", "—"],
];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            {/* Group level */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
            {GROUP.map(([path, title, carries, cp]) => (
              <Route
                key={path}
                path={path}
                element={<PlaceholderPage title={title} carries={carries} checkpoint={cp} />}
              />
            ))}

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