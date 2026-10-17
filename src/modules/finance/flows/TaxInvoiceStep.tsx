import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { issueInvoice, listBillable, type BillableRow } from "../data/billing";
import { IssueInvoiceDialog } from "./IssueInvoiceDialog";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE AT CHECK-OUT (the owner, 17 October, D27-341)

   Once the guest has left, the Bill tab offers the tax invoice where
   Check out was: Issue, with Invoices' own "are you sure", then the
   invoice's page, which prints on the desk's own printer and sends. An
   option, never automatic - and still on Invoices, as before. One per
   bill of a split stay. Who may issue is the server's (invoice create).
   ══════════════════════════════════════════════════════════════════ */

const NOT_SETTLED: Record<string, string> = {
  outstanding: "This bill still carries a balance. Settle it before invoicing.",
  overpaid: "This bill is overpaid. Refund the difference before invoicing.",
};

export function TaxInvoiceStep({
  hotelId, stayId, mayIssue,
}: { hotelId: string; stayId: string; mayIssue: boolean }) {
  const qc = useQueryClient();
  const bills = useQuery({
    queryKey: ["billable", hotelId, stayId],
    queryFn: () => listBillable(hotelId, stayId),
  });
  const [confirming, setConfirming] = useState<BillableRow | null>(null);
  const issue = useMutation({
    mutationFn: (b: BillableRow) => issueInvoice(hotelId, b.stayId, b.folioId),
    onSuccess: () => {
      setConfirming(null);
      /* The series moved on, this bill gained its number and Invoices a row. */
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(stayId)
        || ["billable", "invoices", "invoice-series"].includes(String(q.queryKey[0])) });
    },
  });

  const rows = bills.data ?? [];
  if (rows.length === 0) return null;
  const split = rows.length > 1;

  return (
    <div className="space-y-3" data-tax-invoice-step>
      {rows.map((b) => (
        <div key={b.folioId} className="space-y-2">
          <p className="text-sm font-medium text-ink-900">
            Tax invoice{split ? ` · ${b.billTo}` : ""}
          </p>
          {b.invoice ? (
            <Button asChild variant="primary" className="w-full">
              <Link to={`/h/${hotelId}/invoices/doc/${b.invoice}`} target="_blank" data-tax-invoice-open>
                <Printer className="size-4" />
                Print or send {b.invoice}
              </Link>
            </Button>
          ) : !mayIssue ? (
            <p className="text-sm text-grey-600">
              Not issued yet. Reception, the hotel manager, the accountant, the general manager, an administrator or the owner can issue it.
            </p>
          ) : (
            <>
              <Button variant="primary" className="w-full" data-tax-invoice-issue
                disabled={b.status !== "settled" || issue.isPending}
                onClick={() => { issue.reset(); setConfirming(b); }}>
                <FileText className="size-4" />
                Issue tax invoice
              </Button>
              {NOT_SETTLED[b.status] && (
                <p className="text-xs text-brand-red-700 text-center">{NOT_SETTLED[b.status]}</p>
              )}
            </>
          )}
        </div>
      ))}
      <IssueInvoiceDialog
        hotelId={hotelId}
        about={confirming && `${confirming.guest} · room ${confirming.roomNumber} · ${confirming.reference}`}
        billTo={confirming?.billTo ?? ""}
        pending={issue.isPending}
        error={issue.isError ? issue.error : null}
        onKeep={() => setConfirming(null)}
        onIssue={() => { if (confirming) issue.mutate(confirming); }}
      />
    </div>
  );
}
