import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import { RequireAccess } from "@/components/app/RequireAccess";
import FoliosPage from "@/modules/finance/pages/Folios";
import CashieringPage from "@/modules/finance/pages/Cashiering";
import {
  PaymentsPage, PropertyCityLedgerPage,
} from "@/modules/finance/pages/Billing";
/* Invoices moved out of Billing.tsx when issuing landed. Three screens
   in one file was already a stretch; a fourth with a mutation in it
   was not. */
import InvoicesPage from "@/modules/finance/pages/Invoices";
import InvoicePage from "@/modules/finance/pages/Invoice";
import VatBillPage from "@/modules/finance/pages/VatBill";
import InterimBillPage from "@/modules/finance/pages/InterimBill";

/* Finance's screen addresses. Mounted by App.tsx inside the signed-in
   shell. */
export const routes = (
  <>
    <Route
      path="/h/:code/folios"
      element={<><PropertyScope /><FoliosPage /></>}
    />
    <Route
      path="/h/:code/payments"
      element={<><PropertyScope /><PaymentsPage /></>}
    />
    <Route
      path="/h/:code/invoices"
      element={<><PropertyScope /><InvoicesPage /></>}
    />
    {/* The front desk drawer: open with a float, take receipts,
        count, hand over. */}
    <Route
      path="/h/:code/cashiering"
      element={<><PropertyScope /><CashieringPage /></>}
    />
    {/* An invoice number contains slashes — 5EL/2026-27/00001 — so
        the segment has to swallow them. `*` after the param is how
        react-router spells "the rest of the path". */}
    <Route
      path="/h/:code/invoices/doc/*"
      element={<><PropertyScope /><InvoicePage /></>}
    />
    {/* D22-44: a VAT bill for alcohol, VAT/5EL/2026-27/0001. */}
    <Route
      path="/h/:code/invoices/vat/*"
      element={<><PropertyScope /><VatBillPage /></>}
    />
    {/* The interim bill, printable (QA FI-8): opened from the Bill tab. */}
    <Route
      path="/h/:code/stays/:id/bill"
      element={<><PropertyScope /><InterimBillPage /></>}
    />
    <Route
      path="/h/:code/city-ledger"
      /* Guarded since it is money owed (D27-145). */
      element={<RequireAccess path="/h/:code/city-ledger" resource="commission"><PropertyScope /><PropertyCityLedgerPage /></RequireAccess>}
    />
  </>
);
