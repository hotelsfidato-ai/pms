import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import { cancelWaiting } from "@/modules/reservations/data/booking";

/* ══════════════════════════════════════════════════════════════════
   CANCEL A BOOKING WAITING FOR THE HOTEL (D27-64)

   The owner, 27 September: "cancel it directly". It was never confirmed,
   so there is no charge and nothing is sent; the room it held is free at
   once. Every waiting room booked with it goes too, as Confirm takes them
   all. A short reason stays on the booking. The server decides; this
   shows its answer.
   ══════════════════════════════════════════════════════════════════ */

export function CancelWaitingFlow({ hotelId, stayId, reference, open, onOpenChange }: {
  hotelId: string; stayId: string; reference: string;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const submit = async () => {
    setBusy(true);
    const result = await cancelWaiting(hotelId, stayId, reason.trim());
    setBusy(false);
    if (!result.ok) return toast.error("Not cancelled", result.reason);
    onOpenChange(false);
    setReason("");
    toast.success("Cancelled",
      `${reference}: the room is free again. No charge, and nothing was sent.`);
    void queryClient.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cancel this booking"
        description="It was waiting for the hotel and was never confirmed: no charge, and nothing goes to the guest."
        size="sm"
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button variant="danger" size="lg" loading={busy}
              disabled={!reason.trim()} onClick={() => void submit()}>
              Cancel the booking
            </Button>
          </div>
        }
      >
        <Field label="Why" required hint="“Hotel full that week”, “guest changed plans”.">
          {(f) => (
            <Input {...fieldProps(f)} value={reason} autoFocus
              onChange={(e) => setReason(e.target.value)} className="h-11" />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
