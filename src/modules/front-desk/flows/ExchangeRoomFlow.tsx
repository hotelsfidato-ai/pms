import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, BedDouble } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, EmptyState, toast,
} from "@/components/ui";
import { exchangeableWith, exchangeRooms } from "@/modules/front-desk/data/stayExtras";
import { type Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   TWO GUESTS TRADE ROOMS

   Not a move. A move puts one guest into a room nobody is in; an
   exchange swaps two that are both occupied, which is what a couple
   asking for the quiet side or a family wanting the connecting pair
   actually needs.

   It cannot be done as two moves. `ra_no_double_booking` is checked
   per statement, so the moment one guest is written into the other's
   room — before that one has left it — the row collides and the whole
   thing rolls back. `app.exchange_rooms` releases both and re-assigns
   both in one transaction: either they swap or neither moves.

   FROM A DATE, like a move. The nights already slept stay in the room
   they were slept in — the folio has charges against them and the
   history should read the way the week actually went.
   ══════════════════════════════════════════════════════════════════ */

export function ExchangeRoomFlow({
  hotelId, stay, businessDate, open, onOpenChange,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [withId, setWithId] = useState("");
  const [reason, setReason] = useState("");
  /* Clamped into the stay, like the move flow. Defaulting to `new
     Date()` offered a September date for an August stay once already
     (defect 98) — the hotel's day is the only one that counts. */
  const [from, setFrom] = useState(
    businessDate > stay.arrival ? businessDate : stay.arrival);
  const [busy, setBusy] = useState(false);

  const others = useQuery({
    queryKey: ["exchangeable", hotelId, stay.id],
    queryFn: () => exchangeableWith(hotelId, stay.id),
    enabled: open,
  });

  const chosen = (others.data ?? []).find((o) => o.id === withId);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await exchangeRooms(hotelId, stay.id, {
      withStayId: withId, from, reason: reason.trim(),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not exchanged", res.reason);
    toast.success(
      "Rooms exchanged",
      `${stay.guest} moves to ${res.to}, ${chosen?.guest ?? "the other guest"} `
      + `to ${res.from}, from ${dateShort(from)}.`,
    );
    onOpenChange(false);
    setWithId("");
    setReason("");
    void qc.invalidateQueries();
  };

  const ready = withId && reason.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Exchange ${stay.guest}'s room`}
        description={`${stay.reference} · currently in ${stay.roomNumber}`}
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              <ArrowLeftRight className="size-4" />
              {busy ? "Exchanging…" : "Exchange"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {(others.data ?? []).length === 0 ? (
            <EmptyState
              title="Nobody to swap with"
              description={
                "An exchange trades two occupied rooms. There is no other "
                + "guest in the house right now - to move this guest into an "
                + "empty room, use a room move instead."
              }
            />
          ) : (
            <>
              <div>
                <p className="text-sm text-grey-600 mb-2">
                  Swap with whom? Only guests currently in a room appear - 
                  an empty room is a move, not an exchange.
                </p>
                <ul className="space-y-1.5 max-h-[220px] overflow-y-auto
                               scrollbar-quiet">
                  {(others.data ?? []).map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setWithId(o.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 min-h-11 py-2",
                          "rounded-md border text-left cursor-pointer",
                          "transition-colors duration-150",
                          o.id === withId
                            ? "border-brand-orange bg-brand-orange-50"
                            : "border-grey-200 bg-white hover:border-grey-300",
                        )}
                      >
                        <BedDouble className="size-4 text-grey-400 shrink-0" />
                        <span className="tabular font-medium text-ink-900">
                          {o.room}
                        </span>
                        <span className="text-base text-ink-900 truncate">
                          {o.guest}
                        </span>
                        <span className="ml-auto text-sm text-grey-500 shrink-0">
                          out {dateShort(o.departs)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <Field label="From which night" required
                     hint="Nights already slept stay in the room they were slept in.">
                {(f) => (
                  <Input {...fieldProps(f)} type="date" value={from}
                         min={stay.arrival} max={stay.departure}
                         onChange={(e) => setFrom(e.target.value)} />
                )}
              </Field>

              <Field label="Why" required
                     hint="Two guests changed rooms - somebody will ask.">
                {(f) => (
                  <Input {...fieldProps(f)} value={reason}
                         placeholder="Couple wanted the quiet side"
                         onChange={(e) => setReason(e.target.value)} />
                )}
              </Field>

              {chosen && (
                <p className="text-sm text-grey-600 rounded-md bg-grey-50
                              border border-grey-200 p-3 leading-relaxed">
                  From {dateShort(from)}, {stay.guest} takes {chosen.room} and{" "}
                  {chosen.guest} takes {stay.roomNumber}. Either both move or
                  neither does.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
