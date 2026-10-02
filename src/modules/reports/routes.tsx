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
  StockOnHandPage, StockMovementsPage, StockConsumptionPage, StockWastagePage,
  StockCountDifferencesPage, StockDeadPage, StockCoverPage, SupplierSpendPage, EquipmentReportPage,
} from "@/modules/reports/pages/Store";
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
    {/* The Store and equipment (phase 3A): guarded by their own menu
        entries, which name D27-240's readers. */}
    <Route path="/reports/stock-on-hand" element={<RequireAccess path="/reports/stock-on-hand" resource="stock"><StockOnHandPage /></RequireAccess>} />
    <Route path="/reports/stock-movements" element={<RequireAccess path="/reports/stock-movements" resource="stock"><StockMovementsPage /></RequireAccess>} />
    <Route path="/reports/stock-consumption" element={<RequireAccess path="/reports/stock-consumption" resource="stock"><StockConsumptionPage /></RequireAccess>} />
    <Route path="/reports/stock-wastage" element={<RequireAccess path="/reports/stock-wastage" resource="stock"><StockWastagePage /></RequireAccess>} />
    <Route path="/reports/stock-count-differences" element={<RequireAccess path="/reports/stock-count-differences" resource="stock"><StockCountDifferencesPage /></RequireAccess>} />
    <Route path="/reports/stock-dead" element={<RequireAccess path="/reports/stock-dead" resource="stock"><StockDeadPage /></RequireAccess>} />
    <Route path="/reports/stock-cover" element={<RequireAccess path="/reports/stock-cover" resource="stock"><StockCoverPage /></RequireAccess>} />
    <Route path="/reports/supplier-spend" element={<RequireAccess path="/reports/supplier-spend" resource="stock"><SupplierSpendPage /></RequireAccess>} />
    <Route path="/reports/equipment" element={<RequireAccess path="/reports/equipment" resource="stock"><EquipmentReportPage /></RequireAccess>} />
    <Route path="/reports" element={<RequireAccess path="/reports" resource="report"><ReportsIndexPage /></RequireAccess>} />
  </>
);
