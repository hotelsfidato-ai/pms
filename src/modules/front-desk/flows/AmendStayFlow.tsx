import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import { money, dateShort } from "@/lib/format";
import { amendStay } from "@/modules/front-desk/data/operations";
import type { Stay } from "@/data/repositories";
import { countProblem, dateProblem, MAX_NIGHTS } from "../../../../api/src/validate.ts";

/* ══════════════════════════════════════════════════════════════════
   AMENDING A STAY

   Two more nights, a day early, a child nobody wrote down. Until this
   existed the interface could create a booking and cancel one, and
   nothing in between.

   THE ROOM HOLD MOVES WITH THE BOOKING. That is the whole reason this
   was dangerous to build casually: a booking that says six nights
   while the room is held for four looks perfectly fine on every
   screen until the sixth night's guest opens an occupied door. If the
   room is taken for the nights being added, the server refuses and
   NOTHING changes — not the dates, not the hold.

   THE RATE IS NOT HERE. `agreed_rate` is snapshotted at booking, so
   two extra nights are charged at the rate the guest agreed to, which
   is what a guest expects. Changing it is somebody's decision, not a
   side effect of extending a stay.

   A NIGHT ALREADY CHARGED CANNOT BE DROPPED. The ledger is
   append-only, so the charge cannot quietly vanish — and it should
   not, because the guest may well owe it. Reverse it on the folio
   first, where the reason sits beside it.
   ══════════════════════════════════════════════════════════════════ */

const nightsBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
    / 86_400_000);

export function AmendStayFlow({
  hotelId, stay, open: openProp, onOpenChange,
}: {
  hotelId: string; stay: Stay;
  /* CONTROLLED WHEN GIVEN. Passed both, the flow hides its own button
     and the caller opens it — which is what lets it sit in a menu
     without every flow being rewritten. Passed neither, it behaves
     exactly as it always did. */
  open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (o: boolean) => {
    if (controlled) onOpenChange?.(o); else setOwnOpen(o);
  };
  const [checkIn, setCheckIn] = useState(stay.arrival);
  const [checkOut, setCheckOut] = useState(stay.departure);
  const [adults, setAdults] = useState(String(stay.adults));
  const [children, setChildren] = useState(String(stay.children));
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  /* Once they have arrived, the arrival is a fact. The server refuses a
     change and says so, but a field somebody can type into and then be
     told off for is worse than one they cannot. */
  const arrived = stay.status === "in-house" || stay.status === "due-out";

  const nights = useMemo(
    () => nightsBetween(checkIn, checkOut), [checkIn, checkOut]);
  const was = useMemo(
    () => nightsBetween(stay.arrival, stay.departure),
    [stay.arrival, stay.departure]);

  const changed = checkIn !== stay.arrival || checkOut !== stay.departure
    || Number(adults) !== stay.adults || Number(children) !== stay.children;

  /* FD-4, FD-6, FD-9 (QA, 28 September): children -1 was saved, a cleared
     arrival read "NaN nights", and nothing capped the length. The server's
     own rules (validate.ts), said here before Save. */
  const wrong = dateProblem(checkIn) ?? dateProblem(checkOut)
    ?? countProblem(Number(adults), "Adults", 1) ?? countProblem(Number(children), "Children", 0)
    ?? (nights > MAX_NIGHTS
      ? `A stay is at most ${MAX_NIGHTS} nights. Split a longer one into two bookings.` : null);

  const submit = async () => {
    setBusy(true);
    const result = await amendStay(hotelId, stay.id, {
      checkIn, checkOut,
      adults: Number(adults), children: Number(children),
    });
    setBusy(false);

    if (!result.ok) {
      /* The server's sentence. It names the charged night, or the room
         that is taken — neither of which this screen can know. */
      return toast.error("Not changed", result.reason);
    }

    setOpen(false);
    toast.success(
      "Stay amended",
      result.nightsAfter === 0 && result.nightsBefore === 0
        ? `${result.guest}: still a day use.`
        : result.nightsBefore === result.nightsAfter
        ? `${result.guest}: ${result.nightsAfter} nights, unchanged in length.`
        : `${result.guest}: ${result.nightsBefore} nights becomes `
          + `${result.nightsAfter}${result.roomHeld
              ? `, and ${result.roomHeld} is held to match.` : "."}`,
    );
    void queryClient.invalidateQueries();
  };

  return (
    <>
      {!controlled && (
        <Button
          variant="secondary" size="lg" className="w-full"
          onClick={() => setOpen(true)}
        >
          <CalendarRange className="size-4" />
          Change dates or guests
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Amend ${stay.guest}`}
          description={was === 0 ? `Day use, ${dateShort(stay.arrival)}.`
            : `${was} ${was === 1 ? "night" : "nights"}, ${dateShort(stay.arrival)} to ${dateShort(stay.departure)}.`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary"
                size="lg" loading={busy}
                disabled={!changed || wrong !== null || nights < 0 || (nights === 0) !== (was === 0)}
                onClick={() => void submit()}
              >
                Save
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Arrival"
                hint={arrived ? "They have already arrived." : undefined}
              >
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    type="date" value={checkIn} disabled={arrived}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="h-12 text-base"
                  />
                )}
              </Field>
              <Field label="Departure">
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    type="date" value={checkOut} min={checkIn}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="h-12 text-base"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Adults">
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    type="number" inputMode="numeric" min={1}
                    value={adults} onChange={(e) => setAdults(e.target.value)}
                    className="h-12 text-base tabular"
                  />
                )}
              </Field>
              <Field label="Children">
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    type="number" inputMode="numeric" min={0}
                    value={children} onChange={(e) => setChildren(e.target.value)}
                    className="h-12 text-base tabular"
                  />
                )}
              </Field>
            </div>

            {/* The arithmetic said out loud, because "6 nights" and a pair
                of dates are not the same thing to read in a hurry. */}
            <p className="text-base" data-amend-summary>
              {wrong ? (
                <span className="text-danger">{wrong}</span>
              ) : nights === 0 && was === 0 ? (
                <span className="text-grey-600">
                  Day use, in and out on {dateShort(checkIn)}, at its day price.
                </span>
              ) : (nights === 0) !== (was === 0) && nights >= 0 ? (
                <span className="text-danger">
                  {was === 0
                    ? "A day use stays a day use: its price is the day's. To stay the night, book the nights."
                    : "A stay does not become a day use here: book the day use on New booking, with its day price."}
                </span>
              ) : nights < 1 ? (
                <span className="text-danger">
                  Departure has to be after arrival. The night of departure is
                  not charged, so a guest leaving on the 5th has their last
                  night on the 4th.
                </span>
              ) : nights === was ? (
                <span className="text-grey-600">
                  {nights} {nights === 1 ? "night" : "nights"}, the same as before.
                </span>
              ) : (
                <span className="text-ink-900 font-medium">
                  {was} → {nights} {nights === 1 ? "night" : "nights"}
                  {stay.offeredTariff > 0 && (
                    <span className="font-normal text-grey-600">
                      {" "}· {money(stay.offeredTariff * nights)} of room charges
                      at {money(stay.offeredTariff)} a night
                    </span>
                  )}
                </span>
              )}
            </p>

            <p className="text-sm text-grey-600 leading-relaxed">
              The room hold moves with the booking. If it is taken for the
              nights being added, nothing changes at all and you will be told
              which. Added nights are charged at the rate already agreed - 
              changing that is separate.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
