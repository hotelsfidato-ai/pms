import { ReadyReasons } from "@/modules/front-desk";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, Switch, toast,
} from "@/components/ui";
import { money } from "@/lib/format";
import { useRole } from "@/lib/session";
import { cancelConfirmed, cancelPreview, LIST_KEEPERS } from "@/modules/reservations/data/booking";

/* ══════════════════════════════════════════════════════════════════
   CANCEL A CONFIRMED BOOKING (BK-1; the owner, 28 September)

   The guest cancelled. The terms the booking was made under decide the
   charge (036, 037), and the dialog says what they decide BEFORE the
   clerk confirms: nothing inside the free window, nothing with no terms
   on the booking, otherwise what they keep - on the guest's bill. The
   owner, an administrator or the GM may waive it, with the reason. This
   room only. The server decides; this shows its answer.
   ══════════════════════════════════════════════════════════════════ */

export function CancelConfirmedFlow({ hotelId, stayId, reference, open, onOpenChange, inHouse = false }: {
  hotelId: string; stayId: string; reference: string;
  open: boolean; onOpenChange: (open: boolean) => void;
  /** A guest in house (D27-397): the check-in is undone first, in the same act. */
  inHouse?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const role = useRole();
  const mayWaive = (LIST_KEEPERS as readonly string[]).includes(role);

  const terms = useQuery({
    queryKey: ["cancel-preview", hotelId, stayId, inHouse],
    queryFn: () => cancelPreview(hotelId, stayId, inHouse),
    enabled: open,
  });
  const preview = terms.data?.ok ? terms.data.preview : null;
  const charge = preview?.charge ?? null;

  const submit = async () => {
    setBusy(true);
    const result = await cancelConfirmed(hotelId, stayId, reason.trim(), mayWaive && waive, inHouse);
    setBusy(false);
    if (!result.ok) return toast.error("Not cancelled", result.reason);
    onOpenChange(false);
    setReason("");
    setWaive(false);
    toast.success("Cancelled",
      result.waived ? `${reference}: the room is free again, and the charge was waived.`
        : result.charged ? `${reference}: the room is free again. ${money(result.charged)} is on the guest's bill under its terms.`
        : `${reference}: the room is free again. No charge.`);
    void queryClient.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cancel this booking"
        description={inHouse
          ? "The guest cancelled after checking in. The check-in is undone first; then the terms it was booked under decide the charge. This room only."
          : "The guest cancelled. This room only; the terms it was booked under decide the charge."}
        size="sm"
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button variant="danger" size="lg" loading={busy}
              disabled={!reason.trim() || !preview} onClick={() => void submit()}>
              Cancel the booking
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-900" data-cancel-terms>
            {terms.isLoading ? "Reading the booking's terms…"
              : !terms.data ? "The terms could not be read. Try again."
              : !terms.data.ok ? terms.data.reason
              : charge === null ? "This booking carries no cancellation terms, so nothing is charged."
              : charge === 0 ? `Inside the free window of “${preview?.terms ?? "its terms"}”: nothing is charged.`
              : `Under “${preview?.terms ?? "its terms"}”, ${money(charge)} is kept and goes on the guest's bill. `
                + "An advance already paid stays on the bill."}
          </p>
          {mayWaive && charge !== null && charge > 0 && (
            <Switch checked={waive} onCheckedChange={setWaive}
              label="Waive the charge"
              description="Nothing goes on the bill. The reason below is kept with it." />
          )}
          <Field label="Why" required hint="“Guest changed plans”, “flight cancelled”.">
            {(f) => (
              <Input {...fieldProps(f)} value={reason} autoFocus
                onChange={(e) => setReason(e.target.value)} className="h-11" />
            )}
          </Field>
          {/* The hotel's ready reasons (D27-260). */}
          <ReadyReasons kind="reason_cancel" onPick={setReason} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
