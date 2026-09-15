import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rateOverrideNeedsReason, canConfirmWalkIn } from "@/lib/rules";
import {
  Button, Field, Input, NativeSelect, StatusPill, Switch, toast,
  Dialog, DialogContent,
} from "@/components/ui";
import { createWalkIn } from "@/modules/front-desk/data/operations";
import { listStays } from "@/modules/front-desk/data/stays";
import { getRoom } from "@/data/repositories";

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
  /* NO GUARD MEANT A DOUBLE PRESS BOOKED TWICE. The button stayed live
     through the request, so two taps sent two walk-ins: the first put
     a guest in the room and the second came back "Somebody is already
     in that room" — the desk saw only the refusal and believed nothing
     had happened, while a guest was checked in behind it.

     A room is a scarce resource and this flow takes it in one act, so
     it is exactly the button that must not be pressable twice. */
  const [busy, setBusy] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [ratePlan, setRatePlan] = useState("CP");
  const [rate, setRate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  /* Where the booking came from, and the placement flag. All optional:
     a clerk with somebody standing at the desk must not be blocked on a
     field they do not know the answer to. But it is asked HERE, because
     it cannot be back-filled — a month later nobody remembers which
     agent sent a walk-in, and the source-mix report is built from
     exactly this. */
  const [segment, setSegment] = useState("");
  const [businessSource, setBusinessSource] = useState("");
  const [salesPerson, setSalesPerson] = useState("");
  const [singleLady, setSingleLady] = useState(false);

  /* Derived, never stored. The party is what the two counters say and
     the capacity is what the room type says — neither is a third
     number anybody can set, which is how the two would drift. */
  const party = Math.max(1, adults) + Math.max(0, children);

  const room = useQuery({
    queryKey: ["room", hotelId, roomNumber],
    queryFn: () => getRoom(hotelId, roomNumber),
    enabled: open && !!roomNumber,
  });
  const overCapacity =
    room.data !== null && room.data !== undefined
    && party > room.data.maxOccupancy;

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
    /* Cleared too. A source left over from the last walk-in would be
       attributed to the next guest, silently, and nobody would find it. */
    setSegment(""); setBusinessSource(""); setSalesPerson("");
    setSingleLady(false);
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

          {/* ── WILL THEY FIT ───────────────────────────────────────
              A walk-in is the ONE path where the clerk is looking at
              the actual family and counting them, and it was the one
              that never asked. The booking form has refused an
              over-full party since it was written; this took five into
              a double without a word.

              Shown before they type rather than after they submit: the
              capacity is on screen while the number is being set, so
              the answer arrives while it is still a choice. The server
              refuses independently either way. */}
          {room.data && (
            <div className={cn(
              "rounded-md border p-3 text-sm",
              overCapacity
                ? "border-brand-red-100 bg-red-50 text-brand-red"
                : "border-grey-200 bg-grey-50 text-grey-600",
            )}>
              {overCapacity ? (
                <>
                  <span className="font-medium">
                    {party} will not fit room {roomNumber}.
                  </span>{" "}
                  A {room.data.type} sleeps {room.data.maxOccupancy}. Put them
                  in a larger room, or split them across two.
                </>
              ) : (
                <>
                  Room {roomNumber} is a {room.data.type} and sleeps{" "}
                  {room.data.maxOccupancy}.
                  {party > 0 && ` ${party} in the party.`}
                  {room.data.maxOccupancy - party > 0
                    && ` Room for ${room.data.maxOccupancy - party} more.`}
                  {room.data.maxOccupancy === party && " That is full."}
                </>
              )}
            </div>
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Segment" hint="Leave blank if unknown">
              {({ id }) => (
                <NativeSelect id={id} value={segment}
                  onChange={(e) => setSegment(e.target.value)}>
                  {/* Blank is a real option and stays null. An unknown
                      segment must never become "Other" — that is a guess
                      that turns into a line in a report an owner sets
                      policy from. */}
                  <option value="">—</option>
                  {["Corporate", "Leisure", "Group", "Crew", "Government"]
                    .map((m) => <option key={m}>{m}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Business source" hint="Agent, company, planner">
              {({ id }) => (
                <Input
                  id={id}
                  value={businessSource}
                  onChange={(e) => setBusinessSource(e.target.value)}
                  placeholder="—"
                />
              )}
            </Field>
          </div>

          <Field label="Sold by" hint="Optional">
            {({ id }) => (
              <Input
                id={id}
                value={salesPerson}
                onChange={(e) => setSalesPerson(e.target.value)}
                placeholder="—"
              />
            )}
          </Field>

          {/* A safety practice, not a demographic note. It drives room
              placement away from stairwells and service corridors, and
              it is not read out at the desk. */}
          <Switch
            checked={singleLady}
            onCheckedChange={setSingleLady}
            label="Woman travelling alone"
            description="Placed away from stairwells and service corridors. Not announced at the desk."
          />

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
          <Button variant="primary"
            className="w-full"
            /* Over capacity blocks it here too. The server refuses
               independently, but a clerk should find out while the
               family is still standing there and a bigger room can be
               chosen -- not after pressing the one button. */
            disabled={!permitted.allowed || overCapacity || busy}
            data-walkin-confirm
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              const res = await createWalkIn(hotelId, {
                guestName, roomNumber, nights, adults, children, ratePlan,
                rackTariff: rack ?? offered, offeredTariff: offered,
                overrideReason, businessDate: date, user: USER,
                businessSource, marketSegment: segment, salesPerson,
                isSingleLady: singleLady,
              });
              setBusy(false);
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
            {busy ? "Checking in…" : "Confirm and check in"}
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
