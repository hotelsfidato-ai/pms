import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ShieldCheck } from "lucide-react";
import { money } from "@/lib/format";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import { checkOut, earlyArrival } from "@/modules/front-desk/data/operations";
import { type Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   A GUEST WHO STAYED PAST ELEVEN

   THE BUG THIS FIXES. The server refused a late check-out without a
   reason — correctly, and with the reason on screen — and the
   interface had no way to give it one. `checkOut()` sent `{ user }`
   and nothing else, so the refusal was a DEAD END: press the button,
   read why it will not work, press it again. The owner's screenshot
   showed five identical toasts stacked up, which is exactly what that
   loop looks like.

   Rule 6 says a blocked action is shown WITH its reason. It does not
   say the reason is the end of the conversation. A guard that cannot
   be satisfied is not a guard, it is a wall — and the way through is
   the point of having one.

   WHO MAY DO WHAT, AND WHY THE LINE IS THERE

     anyone at the desk   records the late departure, with a reason.
                          It charges.
     a manager            may WAIVE the charge.

   Recording is an observation: the guest was still in the room at
   four, and that is true whoever noticed. Waiving is a decision about
   money, and somebody has to own it. The manager role's description
   has said "Approves overrides" since it was written — it simply did
   not hold the grant until now.

   THE SERVER DECIDES INDEPENDENTLY. Hiding the waive from a clerk is
   a courtesy to the clerk; `waiveLate` is checked again in the API,
   because a screen is not a permission system.
   ══════════════════════════════════════════════════════════════════ */

export function LateCheckOutFlow({
  hotelId, stay, checkOutTime, charge, open, onOpenChange, onDone,
}: {
  hotelId: string;
  stay: Stay;
  /** The hour the property sells the night until, e.g. "11:00". */
  checkOutTime: string;
  /** What a late departure costs here. Null means the property does
      not charge for one — a decision, and not the same as zero. */
  charge: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  /* The server's own answer (its mayWaive, for this person), as the
     check-in's tick reads it (D24-16, D24-27) - not the role's
     `reservation: approve`, which a hotel's administrator holds and the
     server still refuses. The Bill tab has already asked it. */
  const clock = useQuery({
    queryKey: ["early-arrival", hotelId],
    queryFn: () => earlyArrival(hotelId),
  });
  const mayWaive = clock.data?.mayWaive === true;

  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    const res = await checkOut(hotelId, stay.id, {
      lateReason: reason.trim(),
      waiveLate: mayWaive && waive,
    });
    setBusy(false);

    if (!res.ok) {
      /* THE COMMON OUTCOME, AND IT IS NOT A FAILURE.
         The charge is posted before the balance is tested — so the act
         of recording a late departure creates something to pay, and the
         check-out then refuses for the balance. That is correct and it
         is a two-step: charge, settle, leave.

         The dialog closes on it. Leaving it open invites the reason to
         be typed again, which would record a second late departure on
         a stay that already has one. */
      if (/still outstanding/i.test(res.reason ?? "")) {
        onOpenChange(false);
        onDone();
        toast.warning("Recorded - now settle the bill", res.reason);
        return;
      }
      return toast.error("Could not check out", res.reason);
    }

    toast.success(
      `${stay.guest} checked out`,
      waive && mayWaive
        ? "The late departure is recorded and the charge waived - both are on the stay."
        : charge === null
          ? "The late departure is recorded. The property does not charge for one."
          : `${money(charge)} added to the folio.`,
    );
    setReason("");
    setWaive(false);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Leaving after check-out time"
        description={`${stay.guest} · Room ${stay.roomNumber}`}
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="h-11" disabled={!reason.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Checking out…" : "Check out"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-md border
                          border-amber-300 bg-amber-50 p-3">
            <Clock className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-ink-900 leading-relaxed">
              Check-out here is <span className="tabular">{checkOutTime}</span>.
              A room still occupied after it has been kept out of tonight's
              inventory, and housekeeping cannot turn it around for an arrival
              that is already on the chart. That is why this is written down
              rather than waved through.
            </p>
          </div>

          <Field
            label="Why" required
            hint="Somebody will ask - on the bill, or in the audit trail. A flight time, a manager's say-so, a room not ready on arrival."
          >
            {(f) => (
              <Input {...fieldProps(f)} value={reason}
                     placeholder="Late flight, agreed at reception"
                     onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>

          {/* THE CHARGE, and who may set it aside. */}
          {charge === null ? (
            <p className="text-sm text-grey-600 rounded-md border border-grey-200
                          bg-grey-50 p-3 leading-relaxed">
              This property does not charge for a late departure, so nothing
              will be added. It is still recorded.
            </p>
          ) : mayWaive ? (
            <label className="flex items-start gap-2.5 rounded-md border
                              border-grey-200 bg-grey-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={waive}
                onChange={(e) => setWaive(e.target.checked)}
                className="size-4 mt-0.5 shrink-0 accent-brand-orange cursor-pointer"
              />
              <span className="min-w-0">
                <span className="text-base text-ink-900 flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-brand-orange" />
                  Waive the {money(charge)} charge
                </span>
                <span className="text-sm text-grey-600 mt-0.5 block leading-relaxed">
                  Your decision, recorded against your name. The late departure
                  is still written down - waiving the money does not unwrite
                  the fact.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-grey-600 rounded-md border border-grey-200
                          bg-grey-50 p-3 leading-relaxed">
              {money(charge)} will be added to the folio. A manager can waive
              it - that is a decision about money and it is theirs to make.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
