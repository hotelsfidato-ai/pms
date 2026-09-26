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
   shell. */
export const routes = (
  <>
    {/* Group level */}
    <Route path="/" element={<DashboardPage />} />
    <Route path="/reports/manager" element={<ManagerReportPage />} />
    <Route path="/reports/night-audit" element={<NightAuditReportPage />} />
    <Route path="/reports/city-ledger" element={<CityLedgerPage />} />
    <Route path="/reports/no-show" element={<NoShowPage />} />
    <Route path="/reports/monthly-occupancy" element={<MonthlyOccupancyPage />} />
    <Route path="/reports/monthly-stats" element={<MonthlyStatisticsPage />} />
    <Route path="/reports/yearly-stats" element={<YearlyStatisticsPage />} />
    <Route path="/reports/lodging-tax" element={<LodgingTaxPage />} />
    <Route path="/reports/guest-ledger" element={<GuestLedgerPage />} />
    <Route path="/reports/cashier-shift" element={<CashierShiftPage />} />
    <Route path="/reports/gst-sales" element={<GstSalesPage />} />
    <Route
      path="/reports/c-form"
      element={<RequireAccess path="/reports/c-form" resource="customer"><CFormPage /></RequireAccess>}
    />
    <Route path="/reports" element={<ReportsIndexPage />} />
  </>
);
