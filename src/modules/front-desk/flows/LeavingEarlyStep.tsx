import { CalendarMinus } from "lucide-react";
import { dateShort } from "@/lib/format";
import { Field, fieldProps, Input } from "@/components/ui";
import type { LeavingEarly } from "@/modules/front-desk/data/operations";

/* ══════════════════════════════════════════════════════════════════
   LEAVING EARLY (the owner's D27-315, Part A)

   Inside Check out, one step: the booked departure, today, the nights not
   stayed and a typed reason. On confirm the server ends the stay at the later
   of today and the day after the last night posted, so those nights are not
   charged and go back on sale. The figures are the server's (GET
   /stays/:id/leaving-early); the check-out refuses without the reason anyway.
   ══════════════════════════════════════════════════════════════════ */

export function LeavingEarlyStep({ early, reason, onReason }: {
  early: LeavingEarly;
  reason: string;
  onReason: (r: string) => void;
}) {
  const n = early.nightsFreed;
  return (
    <div className="space-y-4" data-leaving-early>
      <div className="flex items-start gap-2.5 rounded-lg border
                      border-brand-yellow-100 bg-brand-yellow-50 p-3">
        <CalendarMinus className="size-4 text-brand-yellow-800 shrink-0 mt-0.5" />
        <div className="text-sm text-ink-900 leading-relaxed space-y-1">
          <p>
            Booked to leave <span className="tabular">{dateShort(early.departure)}</span>.
            Today is <span className="tabular">{dateShort(early.today)}</span>.
          </p>
          <p className="font-medium">
            Nights not stayed: <span className="tabular">{n}</span> - {n === 1 ? "it is" : "they are"} not
            charged and the room goes back on sale.
          </p>
          {early.bookingSite && (
            <p data-leaving-early-ota>Tell the booking site the guest left early.</p>
          )}
        </div>
      </div>
      <Field label="Why are they leaving early?" required
        hint="Kept on the booking.">
        {(f) => (
          <Input {...fieldProps(f)} value={reason}
                 placeholder="Plans changed"
                 onChange={(e) => onReason(e.target.value)} />
        )}
      </Field>
    </div>
  );
}
