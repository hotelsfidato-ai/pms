import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import { voidStay } from "@/data/repositories";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   VOID — WHICH IS NOT CANCEL

   Two words that mean opposite things to a report:

     cancelled   it HAPPENED and was undone. A guest booked and then
                 changed their mind. It may carry a cancellation
                 charge, and it belongs in cancellation statistics
                 because it measures something real about demand.

     void        it NEVER HAPPENED. Typed twice, entered against the
                 wrong property, made while testing. Counting it as a
                 cancellation inflates a number somebody sets policy
                 from.

   Neither deletes the booking. A reservation that vanishes is one
   nobody can account for when the numbers are questioned later.

   THE SERVER DECIDES, NOT THIS SCREEN. Money on the folio means the
   booking was real enough to be billed, and voiding it would take a
   row out of an append-only ledger by the back door — so the API
   refuses and says so. This dialog does not try to predict that
   answer; it shows the one that comes back.
   ══════════════════════════════════════════════════════════════════ */

export function VoidFlow({
  hotelId, stay, open: openProp, onOpenChange,
}: {
  hotelId: string; stay: Stay;
  open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (o: boolean) => {
    if (controlled) onOpenChange?.(o); else setOwnOpen(o);
  };
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const submit = async () => {
    setBusy(true);
    const result = await voidStay(hotelId, stay.id, reason.trim());
    setBusy(false);

    if (!result.ok) {
      /* Shown, not swallowed. The server's wording tells the clerk what
         to do instead — usually "cancel it, so the terms apply". */
      return toast.error("Not voided", result.reason);
    }

    setOpen(false);
    setReason("");
    toast.success(
      "Voided",
      `${stay.reference} is on the record as never having happened.`,
    );
    void queryClient.invalidateQueries();
  };

  return (
    <>
      {!controlled && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          <Ban className="size-4" />
          Void this booking
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Void this booking"
          description="For one that never happened. Use Cancel if the guest cancelled."
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg"
                onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button
                size="lg"
                loading={busy}
                disabled={!reason.trim()}
                onClick={() => void submit()}
              >
                Void
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-grey-600 leading-relaxed">
              A voided booking stays on the record and is left out of revenue
              <em> and</em> out of cancellation figures. It holds no room from
              the moment you void it.
            </p>

            <Field
              label="Why"
              required
              hint="“Entered twice”, “wrong property”, “test booking”."
            >
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Entered twice"
                  autoFocus
                />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
