import { Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import DashboardPage from "@/modules/reports/pages/Dashboard";
import AllPropertiesPage from "@/modules/reports/pages/AllProperties";
import ManagerReportPage from "@/modules/reports/pages/ManagerReport";
import NightAuditReportPage from "@/modules/reports/pages/NightAudit";
import {
  MonthlyOccupancyPage, MonthlyStatisticsPage, YearlyStatisticsPage,
} from "@/modules/reports/pages/Statistics";
import {
  CityLedgerPage, NoShowPage, LodgingTaxPage, SupplierDuesPage, PettyCashPage, TdsPage, SupplierStatementPage,
  DuesByAgePage, CompanyStatementPage, CommissionPage,
} from "@/modules/reports/pages/Ledgers";
import { Gstr1Page, InputTaxCreditPage, GstAdvancesPage } from "@/modules/reports/pages/Gst";
import VoidsPage from "@/modules/reports/pages/Voids";
import ReportsIndexPage, { StoreReportsPage } from "@/modules/reports/pages/Index";
import {
  StockOnHandPage, StockMovementsPage, StockConsumptionPage, StockWastagePage,
  StockCountDifferencesPage, StockDeadPage, StockCoverPage, SupplierSpendPage, EquipmentReportPage,
  BarStockPage,
  FlrDailyPage,
  FlrMonthlyPage,
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
    <Route path="/all-properties" element={<RequireAccess path="/all-properties" resource="report"><AllPropertiesPage /></RequireAccess>} />
    <Route path="/reports/manager" element={<RequireAccess path="/reports/manager" resource="report"><ManagerReportPage /></RequireAccess>} />
    <Route path="/reports/night-audit" element={<RequireAccess path="/reports/night-audit" resource="report"><NightAuditReportPage /></RequireAccess>} />
    <Route path="/reports/voids" element={<RequireAccess path="/reports/voids" resource="report"><VoidsPage /></RequireAccess>} />
    <Route path="/reports/city-ledger" element={<RequireAccess path="/reports/city-ledger" resource="report"><CityLedgerPage /></RequireAccess>} />
    <Route path="/reports/no-show" element={<RequireAccess path="/reports/no-show" resource="report"><NoShowPage /></RequireAccess>} />
    <Route path="/reports/monthly-occupancy" element={<RequireAccess path="/reports/monthly-occupancy" resource="report"><MonthlyOccupancyPage /></RequireAccess>} />
    <Route path="/reports/monthly-stats" element={<RequireAccess path="/reports/monthly-stats" resource="report"><MonthlyStatisticsPage /></RequireAccess>} />
    <Route path="/reports/yearly-stats" element={<RequireAccess path="/reports/yearly-stats" resource="report"><YearlyStatisticsPage /></RequireAccess>} />
    <Route path="/reports/lodging-tax" element={<RequireAccess path="/reports/lodging-tax" resource="report"><LodgingTaxPage /></RequireAccess>} />
    <Route path="/reports/guest-ledger" element={<RequireAccess path="/reports/guest-ledger" resource="report"><GuestLedgerPage /></RequireAccess>} />
    <Route path="/reports/cashier-shift" element={<RequireAccess path="/reports/cashier-shift" resource="report"><CashierShiftPage /></RequireAccess>} />
    <Route path="/reports/petty-cash" element={<RequireAccess path="/reports/petty-cash" resource="report"><PettyCashPage /></RequireAccess>} />
    <Route path="/reports/gst-sales"element={<RequireAccess path="/reports/gst-sales" resource="report"><GstSalesPage /></RequireAccess>} />
    <Route
      path="/reports/c-form"
      element={<RequireAccess path="/reports/c-form" resource="customer"><CFormPage /></RequireAccess>}
    />
    {/* The Store and equipment (phase 3A): guarded by their own menu
        entries, which name D27-240's readers. */}
    <Route path="/reports/store" element={<RequireAccess path="/reports/store" resource="stock"><StoreReportsPage /></RequireAccess>} />
    <Route path="/reports/stock-on-hand" element={<RequireAccess path="/reports/stock-on-hand" resource="stock"><StockOnHandPage /></RequireAccess>} />
    <Route path="/reports/stock-movements" element={<RequireAccess path="/reports/stock-movements" resource="stock"><StockMovementsPage /></RequireAccess>} />
    <Route path="/reports/stock-consumption" element={<RequireAccess path="/reports/stock-consumption" resource="stock"><StockConsumptionPage /></RequireAccess>} />
    <Route path="/reports/stock-wastage" element={<RequireAccess path="/reports/stock-wastage" resource="stock"><StockWastagePage /></RequireAccess>} />
    <Route path="/reports/stock-count-differences" element={<RequireAccess path="/reports/stock-count-differences" resource="stock"><StockCountDifferencesPage /></RequireAccess>} />
    <Route path="/reports/stock-dead" element={<RequireAccess path="/reports/stock-dead" resource="stock"><StockDeadPage /></RequireAccess>} />
    <Route path="/reports/stock-cover" element={<RequireAccess path="/reports/stock-cover" resource="stock"><StockCoverPage /></RequireAccess>} />
    <Route path="/reports/supplier-spend" element={<RequireAccess path="/reports/supplier-spend" resource="stock"><SupplierSpendPage /></RequireAccess>} />
    <Route path="/reports/equipment" element={<RequireAccess path="/reports/equipment" resource="stock"><EquipmentReportPage /></RequireAccess>} />
    <Route path="/reports/bar-stock" element={<RequireAccess path="/reports/bar-stock" resource="stock"><BarStockPage /></RequireAccess>} />
    <Route path="/reports/flr-daily" element={<RequireAccess path="/reports/flr-daily" resource="stock"><FlrDailyPage /></RequireAccess>} />
    <Route path="/reports/flr-monthly" element={<RequireAccess path="/reports/flr-monthly" resource="stock"><FlrMonthlyPage /></RequireAccess>} />
    {/* What we owe suppliers (D27-370): its own menu entry names the four. */}
    <Route path="/reports/supplier-dues" element={<RequireAccess path="/reports/supplier-dues" resource="invoice"><SupplierDuesPage /></RequireAccess>} />
    {/* D27-372: TDS by section and supplier, and one supplier's statement - the same four. */}
    <Route path="/reports/tds" element={<RequireAccess path="/reports/tds" resource="invoice"><TdsPage /></RequireAccess>} />
    <Route path="/reports/supplier-statement" element={<RequireAccess path="/reports/supplier-statement" resource="invoice"><SupplierStatementPage /></RequireAccess>} />
    {/* D27-383: money owed by age and a statement (Company accounts' readers), commission
        owed (whoever holds `commission`), and GST - each guarded by its own menu entry. */}
    <Route path="/reports/dues-by-age" element={<RequireAccess path="/reports/dues-by-age" resource="invoice"><DuesByAgePage /></RequireAccess>} />
    <Route path="/reports/company-statement" element={<RequireAccess path="/reports/company-statement" resource="invoice"><CompanyStatementPage /></RequireAccess>} />
    <Route path="/reports/commission" element={<RequireAccess path="/reports/commission" resource="commission"><CommissionPage /></RequireAccess>} />
    <Route path="/reports/gstr-1" element={<RequireAccess path="/reports/gstr-1" resource="report"><Gstr1Page /></RequireAccess>} />
    <Route path="/reports/input-tax-credit" element={<RequireAccess path="/reports/input-tax-credit" resource="invoice"><InputTaxCreditPage /></RequireAccess>} />
    <Route path="/reports/gst-advances" element={<RequireAccess path="/reports/gst-advances" resource="invoice"><GstAdvancesPage /></RequireAccess>} />
    <Route path="/reports" element={<RequireAccess path="/reports" resource="report"><ReportsIndexPage /></RequireAccess>} />
  </>
);
