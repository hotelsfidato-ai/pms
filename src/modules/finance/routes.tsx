import { Route } from "react-router";
import { PropertyScope } from "@/components/app/PropertyScope";
import FoliosPage from "@/pages/Folios";
import CashieringPage from "@/pages/Cashiering";
import {
  PaymentsPage, PropertyCityLedgerPage,
} from "@/pages/Billing";
/* Invoices moved out of Billing.tsx when issuing landed. Three screens
   in one file was already a stretch; a fourth with a mutation in it
   was not. */
import InvoicesPage from "@/pages/Invoices";
import InvoicePage from "@/pages/Invoice";

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
    <Route
      path="/h/:code/city-ledger"
      element={<><PropertyScope /><PropertyCityLedgerPage /></>}
    />
  </>
);
