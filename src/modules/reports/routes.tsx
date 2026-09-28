import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import DashboardPage from "@/modules/reports/pages/Dashboard";
import ManagerReportPage from "@/modules/reports/pages/ManagerReport";
import NightAuditReportPage from "@/modules/reports/pages/NightAudit";
import {
  MonthlyOccupancyPage, MonthlyStatisticsPage, YearlyStatisticsPage,
} from "@/modules/reports/pages/Statistics";
import {
  CityLedgerPage, NoShowPage, LodgingTaxPage,
} from "@/modules/reports/pages/Ledgers";
import ReportsIndexPage from "@/modules/reports/pages/Index";
import {
  GuestLedgerPage, CashierShiftPage, GstSalesPage, CFormPage,
} from "@/modules/reports/pages/Compliance";

/* Reports' screen addresses. Mounted by App.tsx inside the signed-in
   shell. Each guarded by its own menu entry since 28 September: the
   server refuses these reads to a role without the grant (D27-141,
   D27-147), so the address says so instead of showing a broken page. */
export const routes = (
  <>
    {/* Group level */}
    <Route path="/" element={<RequireAccess path="/" resource="dashboard"><DashboardPage /></RequireAccess>} />
    <Route path="/reports/manager" element={<RequireAccess path="/reports/manager" resource="report"><ManagerReportPage /></RequireAccess>} />
    <Route path="/reports/night-audit" element={<RequireAccess path="/reports/night-audit" resource="report"><NightAuditReportPage /></RequireAccess>} />
    <Route path="/reports/city-ledger" element={<RequireAccess path="/reports/city-ledger" resource="report"><CityLedgerPage /></RequireAccess>} />
    <Route path="/reports/no-show" element={<RequireAccess path="/reports/no-show" resource="report"><NoShowPage /></RequireAccess>} />
    <Route path="/reports/monthly-occupancy" element={<RequireAccess path="/reports/monthly-occupancy" resource="report"><MonthlyOccupancyPage /></RequireAccess>} />
    <Route path="/reports/monthly-stats" element={<RequireAccess path="/reports/monthly-stats" resource="report"><MonthlyStatisticsPage /></RequireAccess>} />
    <Route path="/reports/yearly-stats" element={<RequireAccess path="/reports/yearly-stats" resource="report"><YearlyStatisticsPage /></RequireAccess>} />
    <Route path="/reports/lodging-tax" element={<RequireAccess path="/reports/lodging-tax" resource="report"><LodgingTaxPage /></RequireAccess>} />
    <Route path="/reports/guest-ledger" element={<RequireAccess path="/reports/guest-ledger" resource="report"><GuestLedgerPage /></RequireAccess>} />
    <Route path="/reports/cashier-shift" element={<RequireAccess path="/reports/cashier-shift" resource="report"><CashierShiftPage /></RequireAccess>} />
    <Route path="/reports/gst-sales" element={<RequireAccess path="/reports/gst-sales" resource="report"><GstSalesPage /></RequireAccess>} />
    <Route
      path="/reports/c-form"
      element={<RequireAccess path="/reports/c-form" resource="customer"><CFormPage /></RequireAccess>}
    />
    <Route path="/reports" element={<RequireAccess path="/reports" resource="report"><ReportsIndexPage /></RequireAccess>} />
  </>
);
