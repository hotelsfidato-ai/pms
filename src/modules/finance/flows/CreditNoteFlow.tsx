import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileMinus } from "lucide-react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Textarea, toast,
} from "@/components/ui";
import { issueCreditNote } from "@/modules/finance/data/billing";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";

/* Who may: `approve` on an invoice - the owner, an administrator, the GM and
   the accountant (the owner's D22-33). The server asks the same grant. */
export const CREDIT_NOTE_WHO =
  "Cancelling an invoice is for the owner, an administrator, the general manager or the accountant.";

/* ══════════════════════════════════════════════════════════════════
   CANCELLING AN INVOICE

   A clerk bills the wrong guest. Until this button existed there was
   no way back: the endpoint, the repository function and the screen
   that renders a credit note all existed, and `issueCreditNote` was
   called by NOTHING. The only credit notes in the database were put
   there by the demo loader.

   AN INVOICE IS NEVER EDITED AND NEVER DELETED. A GST document that
   changes after a guest was handed it is the one an auditor asks
   about first, and a number that vanishes from a sequence is worse.
   The correction is its own numbered document pointing back at the
   original — which is why this is "issue a credit note" rather than
   "cancel", even though cancelling is what a clerk means.

   THE REASON IS REQUIRED BY THE SERVER, not just by this dialog. It
   is the line somebody is asked about a year later, and "correction"
   is what people type when the field is optional.
   ══════════════════════════════════════════════════════════════════ */

export function CreditNoteFlow({ hotelId, number, total }: {
  hotelId: string;
  number: string;
  /** Shown so nobody credits the wrong document from a list of five. */
  total: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const role = useRole();

  /* Rule 6: shown, disabled, with the reason - not a button that is refused. */
  if (!can(role, "approve", "invoice")) {
    return (
      <span className="inline-flex items-center gap-2" data-credit-note-refused>
        <Button variant="secondary" disabled>
          <FileMinus className="size-4" />
          Cancel this invoice
        </Button>
        <span className="text-sm text-grey-600 max-w-64">{CREDIT_NOTE_WHO}</span>
      </span>
    );
  }

  const submit = async () => {
    setBusy(true);
    const result = await issueCreditNote(hotelId, number, reason.trim());
    setBusy(false);

    if (!result.ok) {
      /* The server's wording. It knows whether this invoice has already
         been credited, or is itself a credit note — neither of which
         this dialog can see. */
      return toast.error("Not cancelled", result.reason);
    }

    setOpen(false);
    setReason("");
    toast.success(
      `Credit note ${result.number}`,
      `${number} is cancelled. Both documents stay on the record.`);
    void queryClient.invalidateQueries();
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileMinus className="size-4" />
        Cancel this invoice
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Cancel invoice ${number}`}
          description="A credit note is issued against it. Neither document is deleted."
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button variant="primary"
                size="lg" loading={busy} disabled={!reason.trim()}
                onClick={() => void submit()}
              >
                Issue credit note
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-grey-600 leading-relaxed">
              Invoice <span className="tabular font-medium">{number}</span> for{" "}
              <span className="tabular font-medium">{total}</span> is not
              edited and not deleted - a GST document that changes after a
              guest was handed it is the one an auditor asks about. A credit
              note with its own number is issued against it, and both stay on
              the record.
            </p>

            <Field
              label="Why the invoice was wrong"
              required
              hint="The line somebody is asked about a year from now."
            >
              {(f) => (
                <Textarea
                  {...fieldProps(f)}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Billed to the wrong guest - charges belong to FH-2608-4858."
                />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
