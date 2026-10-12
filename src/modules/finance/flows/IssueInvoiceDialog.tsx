import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { getInvoiceSeries } from "@/modules/finance/data/billing";

/* "ARE YOU SURE", BEFORE A LEGAL NUMBER IS TAKEN (D27-117, QA FI-15): who
   the invoice is to and the number it takes. Invoices' Issue and a group's
   master bill (D27-305 (10)) ask it in the same words. */
export function IssueInvoiceDialog({
  hotelId, about, billTo, pending, error, onKeep, onIssue,
}: {
  hotelId: string;
  /** The bill, in a line. Null keeps the dialog shut. */
  about: string | null;
  billTo: string;
  pending: boolean;
  /** The last try's error, if it failed. */
  error: unknown;
  onKeep: () => void;
  onIssue: () => void;
}) {
  const series = useQuery({
    queryKey: ["invoice-series", hotelId],
    queryFn: () => getInvoiceSeries(hotelId),
    enabled: about !== null,
  });
  const failed = error
    ? describeError(error).message ?? "The invoice was not issued. Nothing was changed."
    : null;

  return (
    <Dialog open={about !== null} onOpenChange={(o) => { if (!o) onKeep(); }}>
      {about !== null && (
        <DialogContent
          title="Issue this tax invoice?"
          description={about}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" onClick={onKeep}>Keep it</Button>
              <Button variant="primary" loading={pending} onClick={onIssue} data-issue-confirm>
                Issue the invoice
              </Button>
            </div>
          }
        >
          <p className="text-sm text-grey-700 leading-relaxed" data-issue-to>
            Billed to <span className="font-medium text-ink-900">{billTo}</span>.
            It takes the next number in the GST series
            {series.data?.[0] ? <> - <span className="tabular font-medium text-ink-900">{series.data[0].next}</span></> : null}.
            An issued invoice is never edited: a wrong one needs a credit note.
          </p>
          {failed && <p className="text-sm text-brand-red-700 mt-3">{failed}</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}
