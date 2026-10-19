import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { getInvoice, issueInvoice, listBillable, type BillableRow, type InvoiceDetail } from "../data/billing";
import { IssueInvoiceDialog } from "./IssueInvoiceDialog";
import { useInvoicePrinter } from "../pages/Invoice";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE AT CHECK-OUT (the owner, 17 October, D27-341; 19
   October, D27-344)

   Once the guest has left, the Bill tab shows the tax invoice where Check
   out was. What check-out does is the hotel's setting (Settings › Front
   desk rules, 229):
     print     (the default) - right after a check-out here, each bill's
               invoice is issued and printed, in the hotel's copies
               (original for recipient, duplicate for supplier), one print;
     offer     - "Issue tax invoice" (Invoices' own "are you sure"), then
               Print or send (D27-341);
     invoices  - nothing here: it is issued on Invoices.
   A bill that cannot be issued says why, with the button. Opened later, the
   stay offers the button. Who may issue is the server's (invoice create).
   ══════════════════════════════════════════════════════════════════ */

const NOT_SETTLED: Record<string, string> = {
  outstanding: "This bill still carries a balance. Settle it before invoicing.",
  overpaid: "This bill is overpaid. Refund the difference before invoicing.",
};

export function TaxInvoiceStep({
  hotelId, stayId, mayIssue, auto = false,
}: {
  hotelId: string; stayId: string; mayIssue: boolean;
  /** Just checked out in this panel: the hotel's "print" setting acts now. */
  auto?: boolean;
}) {
  const qc = useQueryClient();
  const mode = useSession((s) => s.hotels.find((h) => h.code === hotelId || h.id === hotelId))
    ?.deskRules?.invoiceAtCheckout ?? "print";
  const bills = useQuery({
    queryKey: ["billable", hotelId, stayId],
    queryFn: () => listBillable(hotelId, stayId),
  });
  const printer = useInvoicePrinter(hotelId);
  /* The series moved on, this bill gained its number and Invoices a row. */
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(stayId)
    || ["billable", "invoices", "invoice-series"].includes(String(q.queryKey[0])) });

  const [confirming, setConfirming] = useState<BillableRow | null>(null);
  const issue = useMutation({
    mutationFn: (b: BillableRow) => issueInvoice(hotelId, b.stayId, b.folioId),
    onSuccess: () => { setConfirming(null); void refresh(); },
  });

  /* PRINT AT CHECK-OUT: each settled bill's invoice issued, then every
     invoice printed at once. Once, even when React runs an effect twice;
     the server answers a second issue with the same number anyway. */
  const [printed, setPrinted] = useState<InvoiceDetail[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Record<string, string>>({});
  const ran = useRef(false);
  useEffect(() => {
    if (!auto || mode !== "print" || !mayIssue || ran.current || !bills.data) return;
    ran.current = true;
    const rows = bills.data;
    void (async () => {
      setBusy(true);
      const numbers: string[] = [];
      const why: Record<string, string> = {};
      for (const b of rows) {
        if (b.invoice) { numbers.push(b.invoice); continue; }
        if (b.status !== "settled") { why[b.folioId] = NOT_SETTLED[b.status] ?? "Not issued."; continue; }
        try {
          const r = await issueInvoice(hotelId, b.stayId, b.folioId);
          if (r.number) numbers.push(r.number);
          else why[b.folioId] = r.reason ?? "The tax invoice was not issued.";
        } catch (error) {
          why[b.folioId] = describeError(error).message ?? "The tax invoice was not issued.";
        }
      }
      const docs = (await Promise.all(numbers.map((n) => getInvoice(hotelId, n).catch(() => null))))
        .filter((d): d is InvoiceDetail => d !== null);
      setRefused(why);
      setBusy(false);
      setPrinted(docs);
      printer.print(docs);
      void refresh();
    })();
  }, [auto, mode, mayIssue, bills.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = bills.data ?? [];
  if (rows.length === 0 && !busy) return null;
  const split = rows.length > 1;

  return (
    <div className="space-y-3" data-tax-invoice-step>
      {busy && (
        <p className="text-sm text-grey-600" data-tax-invoice-busy>Issuing and printing the tax invoice…</p>
      )}
      {!busy && rows.map((b) => (
        <div key={b.folioId} className="space-y-2">
          <p className="text-sm font-medium text-ink-900">
            Tax invoice{split ? ` · ${b.billTo}` : ""}
          </p>
          {b.invoice ? (
            <Button asChild variant={printed ? "secondary" : "primary"} className="w-full">
              <Link to={`/h/${hotelId}/invoices/doc/${b.invoice}`} target="_blank" data-tax-invoice-open>
                <Printer className="size-4" />
                Print or send {b.invoice}
              </Link>
            </Button>
          ) : !mayIssue ? (
            <p className="text-sm text-grey-600">
              Not issued yet. Reception, the hotel manager, the accountant, the general manager, an administrator or the owner can issue it.
            </p>
          ) : mode === "invoices" && !refused[b.folioId] ? (
            <p className="text-sm text-grey-600" data-tax-invoice-elsewhere>
              Not issued yet: this hotel issues the tax invoice on{" "}
              <Link to={`/h/${hotelId}/invoices`} className="font-medium text-brand-orange-700 hover:underline">Invoices</Link>.
            </p>
          ) : (
            <>
              <Button variant="primary" className="w-full" data-tax-invoice-issue
                disabled={b.status !== "settled" || issue.isPending}
                onClick={() => { issue.reset(); setConfirming(b); }}>
                <FileText className="size-4" />
                Issue tax invoice
              </Button>
              {(refused[b.folioId] ?? NOT_SETTLED[b.status]) && (
                <p className="text-xs text-brand-red-700 text-center" data-tax-invoice-refused>
                  {refused[b.folioId] ?? NOT_SETTLED[b.status]}
                </p>
              )}
            </>
          )}
        </div>
      ))}
      {printed && printed.length > 0 && (
        <Button variant="primary" className="w-full" onClick={() => printer.print(printed)} data-tax-invoice-print-again>
          <Printer className="size-4" />
          Print again
        </Button>
      )}
      <IssueInvoiceDialog
        hotelId={hotelId}
        about={confirming && `${confirming.guest} · room ${confirming.roomNumber} · ${confirming.reference}`}
        billTo={confirming?.billTo ?? ""}
        pending={issue.isPending}
        error={issue.isError ? issue.error : null}
        onKeep={() => setConfirming(null)}
        onIssue={() => { if (confirming) issue.mutate(confirming); }}
      />
      {printer.node}
    </div>
  );
}
