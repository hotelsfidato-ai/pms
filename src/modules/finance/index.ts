/* The front door of the Finance service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { getFolio, listOpenFolios } from "./data/folios";
export { getFolioBalance } from "./data/postings";
export { FolioPanel, ChangeRateDialog, useStayDue } from "./flows/FolioPanel";
export { TaxRulesCard } from "./flows/TaxRulesCard";
/* The bill as it stands (D21-10): one definition on the server
   (app.stay_bill), one printed layout — the desk's and the guest's page's. */
export { getStayBill, type StayBill, type StayBillLine } from "./data/bill";
export { BillPrint } from "./flows/BillPrint";
/* The address with its town once (QA FI-16), for any screen that prints it. */
export { placeLine } from "./place";
/* New booking (Phase 1): the tax a nightly rate will carry, from the tax
   card's one slab rule, and the companies a booking can be billed to. */
export { getTaxRate, getRateBeforeGst } from "./data/tax";
export { listBillingCompanies, type BillingCompany } from "./data/folios";
/* D27-163 (delegated by the master): the one page takes an advance through
   the bill's own payment door, held as the guest's credit (D27-4). */
export { settle } from "./data/postings";
/* D27-305 (10): a group's master bill is settled and invoiced on the group's
   page with the bill's own Settle and Invoices' own "are you sure". */
export { SettleDialog } from "./flows/FolioPanel";
export { IssueInvoiceDialog } from "./flows/IssueInvoiceDialog";
export { settleGroupBill } from "./data/postings";
export { issueGroupInvoice } from "./data/billing";
