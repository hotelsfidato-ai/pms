import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rateOverrideNeedsReason, canConfirmWalkIn } from "@/lib/rules";
import {
  Button, Field, Input, NativeSelect, StatusPill, toast,
  Dialog, DialogContent,
} from "@/components/ui";
import { createWalkIn, listStays, getRoom } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   FLOW D — the walk-in at 23:40

   The hardest and most common flow at these properties, and the one
   most systems get wrong by treating it as a booking followed by a
   check-in. It is ONE act, and it ends in one button.

   The guest field searches existing guests and creates a new one in
   the same input — a clerk with someone standing at the desk should
   not have to decide which mode they are in first.
   ══════════════════════════════════════════════════════════════════ */

const USER = "front desk";

export function WalkInFlow({
  hotelId, roomNumber, date, open, onOpenChange,
}: {
  hotelId: string;
  roomNumber: string;
  date: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();

  const [guestName, setGuestName] = useState("");
  const [nights, setNights] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [ratePlan, setRatePlan] = useState("CP");
  const [rate, setRate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const room = useQuery({
    queryKey: ["room", hotelId, roomNumber],
    queryFn: () => getRoom(hotelId, roomNumber),
    enabled: open && !!roomNumber,
  });
  const existing = useQuery({
    queryKey: ["guest-search", hotelId, guestName],
    queryFn: () => listStays(hotelId, { search: guestName }),
    enabled: open && guestName.trim().length >= 2,
  });

  /* THE RATE IS THE HOTEL'S, NOT THIS FILE'S.

     This read `RACK[room.data.type] ?? 4099` — a table of two names
     held in the frontend, defaulting to 4,099 for anything else. At a
     property with no "Superior" or "Deluxe" a clerk was shown a
     pre-filled tariff nobody at Fidato had ever chosen, and the
     override check below measured "is this a discount?" against that
     same invention.

     Now it comes from the room's own type. Null when the hotel has not
     set one — 032 stopped the templates shipping prices — and a null
     rack means there is nothing to pre-fill and nothing to discount
     from, so the clerk types the tariff and no reason is demanded. */
  const rack = room.data?.rackRate ?? null;
  const typed = rate === "" ? null : Number(rate) || 0;
  const offered = typed ?? rack ?? 0;
  const needsReason =
    rack === null ? false : rateOverrideNeedsReason(rack, offered);

  const permitted = canConfirmWalkIn({
    guestName, nights, offeredTariff: offered, rackTariff: rack ?? offered,
    overrideReason,
  });

  /* Distinct guests already known by that name — a walk-in is often a
     returning guest, and re-typing them creates a duplicate. */
  const matches = [
    ...new Map((existing.data ?? []).map((s) => [s.guest, s])).values(),
  ].filter((s) => s.guest.toLowerCase().includes(guestName.trim().toLowerCase()));

  const reset = () => {
    setGuestName(""); setNights(1); setAdults(2); setChildren(0);
    setRatePlan("CP"); setRate(""); setOverrideReason("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent
        title="Walk-in"
        description={`Room ${roomNumber} · arriving ${date}`}
      >
        <div className="space-y-4">
          {/* Search and create in the same field */}
          <Field
            label="Guest"
            hint="Type a name — existing guests appear as you type"
            required
          >
            {({ id }) => (
              <Input
                id={id}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Name"
                autoFocus
              />
            )}
          </Field>

          {matches.length > 0 && (
            <ul className="-mt-2 border border-grey-200 rounded-md divide-y divide-grey-100 max-h-32 overflow-y-auto scrollbar-quiet">
              {matches.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setGuestName(s.guest)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-grey-50 transition-colors duration-150"
                  >
                    <span className="text-base text-ink-900 truncate">{s.guest}</span>
                    <StatusPill tone="neutral" className="ml-auto shrink-0">
                      stayed before
                    </StatusPill>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Nights">
              {({ id }) => (
                <Input
                  id={id} numeric value={String(nights)}
                  onChange={(e) => setNights(Math.max(1, Number(e.target.value) || 1))}
                />
              )}
            </Field>
            <Field label="Adults">
              {({ id }) => (
                <Input
                  id={id} numeric value={String(adults)}
                  onChange={(e) => setAdults(Number(e.target.value) || 0)}
                />
              )}
            </Field>
            <Field label="Children">
              {({ id }) => (
                <Input
                  id={id} numeric value={String(children)}
                  onChange={(e) => setChildren(Number(e.target.value) || 0)}
                />
              )}
            </Field>
          </div>

          <Field label="Meal plan">
            {({ id }) => (
              <NativeSelect id={id} value={ratePlan} onChange={(e) => setRatePlan(e.target.value)}>
                {["CP", "Room Only", "EP", "MAP"].map((p) => <option key={p}>{p}</option>)}
              </NativeSelect>
            )}
          </Field>

          <Field
            label="Rate per night"
            hint={
              rack === null
                ? "This room type has no rate set, so there is nothing to compare against. Enter what the guest is paying."
                : `Rack is ${money(rack)}`
            }
          >
            {({ id }) => (
              <Input
                id={id}
                numeric
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder={rack === null ? "Tariff" : String(rack)}
              />
            )}
          </Field>

          {/* An override is allowed — but the reason is kept */}
          {needsReason && (
            <div className="rounded-md border border-brand-yellow-100 bg-brand-yellow-50 p-3 space-y-2.5">
              <p className="flex items-start gap-2 text-sm text-[#8a6300]">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  {money((rack ?? 0) - offered)} below rack —{" "}
                  {Math.round((((rack ?? 0) - offered) / (rack || 1)) * 100)}% off.
                  The reason is kept on the reservation.
                </span>
              </p>
              <Field label="Reason" required>
                {({ id }) => (
                  <Input
                    id={id}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Late arrival, last room"
                  />
                )}
              </Field>
            </div>
          )}

          <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1">
            <Row label={`${nights} night${nights === 1 ? "" : "s"} × ${money(offered)}`} value={money(offered * nights)} />
            <Row label="Tax 5%" value={money(Math.round(offered * nights * 0.05 * 100) / 100)} muted />
            <div className="pt-1 border-t border-grey-200">
              <Row label="Total" value={money(Math.round(offered * nights * 1.05 * 100) / 100)} bold />
            </div>
          </div>

          {!permitted.allowed && permitted.reason && (
            <p className="text-xs text-brand-red">{permitted.reason}</p>
          )}

          {/* ONE action. Not "book" then "check in". */}
          <Button
            className="w-full"
            disabled={!permitted.allowed}
            data-walkin-confirm
            onClick={async () => {
              const res = await createWalkIn(hotelId, {
                guestName, roomNumber, nights, adults, children, ratePlan,
                rackTariff: rack ?? offered, offeredTariff: offered,
                overrideReason, businessDate: date, user: USER,
              });
              if (res.ok) {
                toast.success(
                  `${guestName} is in house`,
                  `Room ${roomNumber} · ${nights} night${nights === 1 ? "" : "s"}`,
                );
                onOpenChange(false);
                reset();
                qc.invalidateQueries();
              } else {
                toast.error("Could not check in", res.reason);
              }
            }}
          >
            <UserPlus className="size-4" />
            Confirm and check in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label, value, muted, bold,
}: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className={cn("text-sm", muted ? "text-grey-500" : "text-grey-700")}>{label}</span>
      <span className={cn("tabular shrink-0", bold ? "text-base font-semibold text-ink-900" : "text-sm text-ink-900")}>
        {value}
      </span>
    </div>
  );
}

export { Check };
