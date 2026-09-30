import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, DoorOpen } from "lucide-react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  toast,
} from "@/components/ui";
import { money } from "@/lib/format";
import { moveRoom, unassignRoom } from "@/modules/front-desk/data/operations";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   MOVING A GUEST

   Room 203 to 305 on night three. The stay is not one assignment but
   two after this — 203 keeps the nights already slept in it, 305
   takes the rest — because `room_assignments` is keyed by date range
   and always has been.

   THE MONEY IS NOT TOUCHED BY A MOVE, and this dialog says so out
   loud rather than leaving a clerk to wonder. The night audit posts
   the reservation's agreed rate, snapshotted at booking and never
   looked up again; nights already posted are history in an
   append-only ledger. A move is a change of room, not a repricing.

   THE RATE IS A SEPARATE, DELIBERATE ACT. When the room type changes
   it usually should change too, so the field appears — but it is
   empty, it is optional, and it is described as applying from
   tonight, because that is what it does: the audit charges one night
   at a time, so it can only ever reach nights not yet posted. On the
   arrival day tonight IS posted, at check-in (D27-204): the server puts
   that one line right to the new rate as part of the move (D27-205), so
   "from tonight" holds on every day.

   WHY THEY MOVED IS RECORDED. `reason` already allowed move,
   upgrade, downgrade, fault and group_consolidation before this
   screen existed. A fault is the one that matters later — it is the
   difference between a guest who asked to move and a hotel that had
   to move them, and it is the question somebody asks when a
   complaint arrives a week afterwards.
   ══════════════════════════════════════════════════════════════════ */

const REASONS: { value: string; label: string; hint: string }[] = [
  { value: "move", label: "Guest asked to move",
    hint: "They wanted a different room" },
  { value: "upgrade", label: "Upgrade",
    hint: "A better room, usually at the same rate" },
  { value: "downgrade", label: "Downgrade",
    hint: "A lesser room - the rate usually comes down with it" },
  { value: "fault", label: "Something wrong with the room",
    hint: "The hotel had to move them. Worth being able to find later" },
  { value: "group_consolidation", label: "Putting a group together",
    hint: "Rearranging so a group is on one floor" },
];

export function MoveRoomFlow({
  hotelId, stay, businessDate, open: openProp, onOpenChange,
}: {
  hotelId: string; stay: Stay; businessDate: string;
  /* Controlled when both are given, so this can sit in a menu. */
  open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (o: boolean) => {
    if (controlled) onOpenChange?.(o); else setOwnOpen(o);
  };
  const [room, setRoom] = useState("");
  const [reason, setReason] = useState("move");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  /* The night of departure belongs to nobody, so the last night anybody
     can be moved is the one before it. */
  const lastMovable = useMemo(() => {
    const d = new Date(`${stay.departure}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [stay.departure]);

  /* THE HOTEL'S OPERATING DAY, not the browser's clock. A property whose
     night audit has not run yet is still on yesterday, and defaulting to
     the real date put 3 September into a dialog for a stay in August —
     which the server correctly refused as outside the stay, leaving a
     clerk to wonder what they had done wrong.

     Clamped into the stay at both ends, so the field opens on a night
     that can actually be chosen. */
  const defaultFrom = useMemo(() => {
    if (businessDate < stay.arrival) return stay.arrival;
    if (businessDate > lastMovable) return lastMovable;
    return businessDate;
  }, [businessDate, stay.arrival, lastMovable]);
  const [from, setFrom] = useState(defaultFrom);

  const submit = async () => {
    setBusy(true);
    const result = await moveRoom(hotelId, stay.id, {
      roomNumber: room.trim(),
      from,
      reason: reason as "move",
      ...(rate.trim() === "" ? {} : { agreedRate: Number(rate) }),
    });
    setBusy(false);

    if (!result.ok) {
      /* The server's wording, not a guess at it. It names the room that
         is taken, or the dates of the stay. */
      return toast.error("Not moved", result.reason);
    }

    setOpen(false);
    setRoom(""); setRate("");
    toast.success(
      `Moved to ${result.to}`,
      result.nightsBefore === 0
        ? `${result.guest} is in ${result.to} for the whole stay.`
        : `${result.nightsBefore} ${result.nightsBefore === 1 ? "night" : "nights"}`
          + ` stay with ${result.from}, ${result.nightsAfter} in ${result.to}.`,
    );
    void queryClient.invalidateQueries();
  };

  const unassign = async () => {
    setBusy(true);
    const result = await unassignRoom(hotelId, stay.id);
    setBusy(false);
    if (!result.ok) return toast.error("Not changed", result.reason);
    setOpen(false);
    toast.success("Out of the room",
      `${stay.guest} is no longer in ${result.room}. The booking still stands.`);
    void queryClient.invalidateQueries();
  };

  const chosen = REASONS.find((r) => r.value === reason)!;

  return (
    <>
      {!controlled && (
        <Button
          variant="secondary" size="lg" className="w-full"
          onClick={() => setOpen(true)}
        >
          <ArrowRightLeft className="size-4" />
          Move to another room
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Move ${stay.guest}`}
          description={`Currently in ${stay.roomNumber || "no room"}.`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary"
                size="lg" loading={busy} disabled={!room.trim()}
                onClick={() => void submit()}
              >
                Move
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="To which room" required>
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="305"
                  className="h-12 text-base"
                  autoFocus
                />
              )}
            </Field>

            <Field
              label="From which night"
              hint={`The first night in the new room. Up to ${lastMovable} -`
                + " the night of departure belongs to nobody."}
            >
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  type="date"
                  min={stay.arrival} max={lastMovable}
                  value={from} onChange={(e) => setFrom(e.target.value)}
                  className="h-12 text-base"
                />
              )}
            </Field>

            <Field label="Why">
              {(f) => (
                <NativeSelect
                  {...fieldProps(f)}
                  value={reason} onChange={(e) => setReason(e.target.value)}
                  className="h-12 text-base"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <p className="-mt-2 text-sm text-grey-500">{chosen.hint}</p>

            <Field
              label="New rate per night"
              hint="Optional. Leave empty and nothing about the money changes."
            >
              {(f) => (
                <Input
                  {...fieldProps(f)}
                  type="number" inputMode="decimal" min={0}
                  value={rate} onChange={(e) => setRate(e.target.value)}
                  placeholder={String(stay.offeredTariff)}
                  className="h-12 text-base tabular"
                />
              )}
            </Field>

            {/* Said plainly, because it is the question a clerk will
                otherwise ask a manager, and the manager will guess. */}
            <p className="text-sm text-grey-600 leading-relaxed">
              Moving rooms changes no charge on its own. Nights already
              posted stay as they are - the guest slept in{" "}
              {stay.roomNumber || "that room"} for them. A new rate applies
              from tonight forward; to change a night already billed, adjust
              it on the folio so there is a reason beside it.
              {stay.offeredTariff > 0 && (
                <> Currently {money(stay.offeredTariff)} a night.</>
              )}
            </p>

            <button
              type="button"
              onClick={() => void unassign()}
              disabled={busy || !stay.roomNumber}
              className="flex items-center gap-2 text-sm text-grey-600
                         hover:text-ink-900 underline cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <DoorOpen className="size-3.5" />
              Take them out of the room without assigning another
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
