import { BookOpen, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Accounting export — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Accounting export",
  summary: "Each closed day's sales, tax, receipts and refunds handed to the accountant, or straight into Tally.",
  willDo: [
    { icon: FileSpreadsheet, title: "The day, in the accountant's form",
      body: "One file for each closed day with sales, tax, receipts and refunds, ready to enter or import." },
    { icon: BookOpen, title: "Your ledgers, matched",
      body: "This system's accounts mapped once to the ledger names in your books." },
    { icon: ShieldCheck, title: "Figures that stay put",
      body: "Only days the night audit has closed are exported, so a figure never changes after the accountant has it." },
  ],
  needs: [
    "What your accountant uses: Tally, and which version.",
    "The ledger names in your books.",
    "Whether a CSV file is enough, or it must be an Excel workbook.",
  ],
  today: "The reports print and export CSV, among them the GST sales register, lodging tax and cashier shifts. None of them goes into Tally.",
  leansOn: ["Night audit", "Invoices", "All reports"],
};

export default function AccountingPage() {
  return <ComingSoonPage content={CONTENT} />;
}
