import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button, DocPage } from "@/components/ui";
import { useGroupSettings } from "@/modules/admin";
import { useDocumentTitle } from "@/lib/documentTitle";
import { getStayBill } from "../data/bill";
import { BillPrint } from "../flows/BillPrint";

/* ══════════════════════════════════════════════════════════════════
   THE PROFORMA BILL, ON PAPER (QA FI-8, 28 September; the interim bill
   until the owner's D27-344)

   The Bill tab's "Interim bill" was a preview with only Close: the desk
   could not print it. A dialog prints the screen behind it too, so the
   print is a page of its own, like the tax invoice, the VAT bill and the
   restaurant's bill - the app's shell stays off the paper (DocPage). The
   bill is app.stay_bill's, drawn by the same BillPrint as the dialog and
   the guest's page.
   ══════════════════════════════════════════════════════════════════ */

export default function InterimBillPage() {
  const { code = "", id = "" } = useParams();
  const bill = useQuery({ queryKey: ["stay-bill", code, id], queryFn: () => getStayBill(code, id) });
  const group = useGroupSettings(code);
  useDocumentTitle("Proforma bill");

  return (
    <DocPage
      toolbar={
        <Button variant="primary" onClick={() => window.print()} disabled={!bill.data}>
          <Printer className="size-4" />
          Print
        </Button>
      }
    >
      {bill.data ? (
        <BillPrint bill={bill.data} group={group} />
      ) : bill.isError ? (
        <p className="text-sm text-brand-red-700">The bill could not be read. Try again.</p>
      ) : bill.isFetched ? (
        <p className="text-sm text-grey-600">This stay has no bill yet.</p>
      ) : (
        <p className="text-sm text-grey-600">One moment…</p>
      )}
    </DocPage>
  );
}
