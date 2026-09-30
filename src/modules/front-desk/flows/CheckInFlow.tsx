import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogIn, BedDouble } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import {
  Button, Field, Input, NativeSelect, StatusPill, Switch, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger,
} from "@/components/ui";
import { checkIn, assignableRooms, checkInAllowed, earlyArrival, mealPlanChoices } from "@/modules/front-desk/data/operations";
import { type Stay } from "@/data/repositories";
import {
  BookingSiteBlacklist, GuestIdFields, guestIdState, guestIdPayload, noGuestId, type GuestId,
} from "@/modules/guests";
import { countProblem } from "../../../../api/src/validate.ts";
import { WaitingDetailsLink } from "@/modules/online-checkin";
import { getTaxRate } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   FLOW A — arrival to in house, ON ONE PAGE (D27-163)

   It was five steps behind four Continues: the party, the room, the ID,
   the rate, done - eight clicks from Arrivals. The owner's rule of 29
   September is two pages or three clicks, so the same boxes now sit on
   one page under one "Check in": Arrivals, the row, Check in, Check in.
   Same call, same body.

   Only clean or inspected rooms can take a guest. A dirty room appears,
   disabled, with the reason - hiding it would teach nobody why. And the
   button stays greyed with "Pick a room" until one is chosen: the steps
   let Continue through the Room step with none, and the server answered
   "Choose a room." at the very end (the speed lane's finding 6).
   ══════════════════════════════════════════════════════════════════ */

export function CheckInFlow({
  hotelId, stay, businessDate, onDone,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* As typed (FD-8): "abc" used to become 0 adults, and 0 reached the
     database's own check as "Something went wrong". */
  const [adultsText, setAdults] = useState(String(stay.adults));
  const [childrenText, setChildren] = useState(String(stay.children));
  const adults = Number(adultsText);
  const children = Number(childrenText);
  const partyWrong = countProblem(adults, "Adults", 1) ?? countProblem(children, "Children", 0);
  const [roomNumber, setRoomNumber] = useState(stay.roomNumber);
  /* The document, the nationality ON FILE (not "IN": a foreign guest
     checked in with the default left the Form III register, D27-25), and
     Form III - the guests service's one block, the one page's too. */
  const [guestId, setGuestId] = useState<GuestId>(() => noGuestId(stay.nationality ?? "IN"));
  const id = guestIdState(guestId, businessDate);
  const [earlyReason, setEarlyReason] = useState("");
  const [waiveEarly, setWaiveEarly] = useState(false);
  /* D25-39: offers only to a guest who said yes - asked here, face to face,
     for a guest booked by phone or a booking site. */
  const [offersAgreed, setOffersAgreed] = useState(false);
  const [ratePlan, setRatePlan] = useState(stay.ratePlan);

  const permitted = useQuery({
    queryKey: ["checkin-allowed", hotelId, stay.id, stay.status],
    queryFn: () => checkInAllowed(hotelId, stay.id, businessDate),
  });
  /* Is it early, and what does the property charge? Asked of the
     server so the answer is the property's clock, not the device's. */
  const early = useQuery({
    queryKey: ["early-checkin", hotelId],
    queryFn: () => earlyArrival(hotelId),
    enabled: open,
  });

  const rooms = useQuery({
    queryKey: ["assignable", hotelId, stay.roomType, businessDate,
               stay.roomNumber],
    queryFn: () => assignableRooms(hotelId, stay.roomType, businessDate,
                                   stay.roomNumber),
    enabled: open,
  });

  /* TWO KINDS OF EARLY, and they are not the same thing.

       by the CLOCK   the booking is for today, but it is before the
                      hour the property lets rooms go
       by the DATE    the booking is for a later day and the guest is
                      standing here now

     The second used to be a flat refusal. It is a normal Tuesday: the
     room is free, the desk puts them in it, and the booking moves to
     today so the night audit charges for the night they actually
     slept. Both need a reason; the server refuses without one either
     way. */
  const earlyByDate = stay.arrival > businessDate;
  const earlyByClock = early.data?.isEarly ?? false;
  const isEarly = earlyByClock || earlyByDate;

  /* MORE THAN A DAY EARLY MOVES THE WHOLE BOOKING (D27-193): the first press
     shows the move and what the stay now costs; nothing moves until Confirm,
     and the server refuses the move without it. */
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const bigMove = day(stay.arrival) - day(businessDate) > 1;
  const movedNights = day(stay.departure) - day(businessDate);
  const [confirming, setConfirming] = useState(false);
  const gst = useQuery({
    queryKey: ["tax-rate", hotelId, "room", stay.offeredTariff],
    queryFn: () => getTaxRate(hotelId, "room", stay.offeredTariff),
    enabled: open && bigMove && !stay.isComplimentary && stay.offeredTariff > 0,
  });
  const paise = (n: number) => Math.round(n * 100);
  /* GST a night as the night audit posts it, rounded to the paisa. */
  const taxNight = gst.data?.rate == null ? null
    : Math.round(paise(stay.offeredTariff) * gst.data.rate / 100) / 100;
  const moved = `This moves the arrival from ${dateShort(stay.arrival)} to ${dateShort(businessDate)}: `
    + `${movedNights} nights, `
    + (stay.isComplimentary ? "complimentary."
      : taxNight === null
        ? `${moneyPrecise(stay.offeredTariff * movedNights)} before GST (no GST rule for this rate).`
        : `${moneyPrecise((paise(stay.offeredTariff) + paise(taxNight)) * movedNights / 100)} with GST.`);

  const allowed = (permitted.data?.allowed ?? false) || earlyByDate;
  const reason = permitted.data?.reason;

  /* RULE 6: the one button says why it is greyed, under it. */
  const chosen = (rooms.data ?? []).find((r) => r.number === roomNumber);
  const blocked =
    partyWrong
      ?? (!roomNumber || !chosen ? "Pick a room."
        : !chosen.allowed ? `Room ${roomNumber}: ${chosen.reason ?? "not available."}` : null)
      ?? id.blocked
      ?? (isEarly && !earlyReason.trim() ? "Say why the room is being given early." : null);

  const reset = () => {
    setAdults(String(stay.adults)); setChildren(String(stay.children));
    setRoomNumber(stay.roomNumber); setGuestId(noGuestId(stay.nationality ?? "IN"));
    setEarlyReason(""); setWaiveEarly(false); setOffersAgreed(false); setRatePlan(stay.ratePlan);
    setConfirming(false);
  };

  const submit = async () => {
    setBusy(true);
    const res = await checkIn(hotelId, stay.id, {
      roomNumber, adults, children, ratePlan,
      /* The nationality always - with the ID skipped too, or a foreign
         guest never reached the Form III register; the document only when
         a type and a number were both typed. */
      ...guestIdPayload(guestId),
      businessDate,
      /* Sent since 24 September: without it the server refused every
         check-in before the check-in hour. */
      earlyReason, waiveEarly, offersAgreed,
      ...(bigMove ? { confirmMove: true } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`${stay.guest} is in house`, `Room ${roomNumber} · the arrivals count has dropped.`);
      setOpen(false);
      reset();
      qc.invalidateQueries();
      onDone?.();
    } else {
      toast.error("Could not check in", res.reason);
    }
  };

  /* THE REASON, not just a dead button. `canCheckIn` produces a real
     sentence — "Arrival is 30 Aug 2026. Check-in opens on the arrival
     date." — and the trigger used to throw it away, leaving a clerk
     with a greyed control and nothing to act on. */
  const trigger = (
    <div className="space-y-1.5">
      {/* PRIMARY. On an arrival this is the reason the panel is open —
          the one orange button, at the top beside "More options", where
          the owner's reference layout puts the main act. */}
      <Button variant="primary" disabled={!allowed} data-checkin>
        <LogIn className="size-4" />
        Check in
      </Button>
      {!allowed && reason && (
        <p className="text-sm text-grey-500 leading-snug" data-checkin-reason>
          {reason}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {/* NO TOOLTIP: a tooltip needs a pointer, and on the desk's tablet
            it can never be opened; the reason is written under it. */}
        {trigger}
      </DialogTrigger>

      <DialogContent
        title={`Check in ${stay.guest}`}
        description={`${stay.reference} · ${stay.roomType}`}
        footer={
          confirming ? (
            <div className="w-full space-y-2" data-checkin-move>
              <p className="text-sm text-warning-dark">{moved}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy}
                  disabled={busy || gst.isLoading} onClick={() => void submit()}>
                  <Check className="size-4" />
                  Confirm
                </Button>
              </div>
            </div>
          ) : (
          <div className="w-full space-y-1.5">
            <Button variant="primary" className="w-full" loading={busy}
              disabled={busy || blocked !== null}
              onClick={() => (bigMove ? setConfirming(true) : void submit())}>
              <Check className="size-4" />
              Check in
            </Button>
            {blocked && (
              <p className="text-sm text-grey-600" data-checkin-blocked>{blocked}</p>
            )}
          </div>
          )
        }
      >
        {/* CRM-3 (D22-8): a booking site's guest on a blacklisted phone or email. */}
        <div className="mb-4 empty:hidden">
          <BookingSiteBlacklist hotelId={hotelId} from={stay.arrival} to={stay.arrival} stayIds={[stay.id]} />
        </div>

        <div className="space-y-5">
          <section className="space-y-3">
            <p className="text-sm text-grey-600">
              Who is actually arriving. The booking says{" "}
              {stay.adults} adult{stay.adults === 1 ? "" : "s"}
              {stay.children ? `, ${stay.children} child` : ""}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Adults">
                {({ id: f }) => (
                  <Input id={f} numeric value={adultsText} onChange={(e) => setAdults(e.target.value)} />
                )}
              </Field>
              <Field label="Children">
                {({ id: f }) => (
                  <Input id={f} numeric value={childrenText} onChange={(e) => setChildren(e.target.value)} />
                )}
              </Field>
            </div>
            {partyWrong && (
              <p className="text-sm text-brand-red-700" data-party-wrong>{partyWrong}</p>
            )}
          </section>

          <section className="space-y-3 pt-4 border-t border-grey-200">
            <p className="text-sm text-grey-600">
              Room. Only a clean or inspected room can take a guest; the rest are
              shown with the reason.
            </p>
            {/* One column on a phone: two cut "inspected" off at 390 px. */}
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto scrollbar-quiet">
              {(rooms.data ?? []).map((room) => {
                const selected = room.number === roomNumber;
                const body = (
                  <button
                    type="button"
                    disabled={!room.allowed}
                    onClick={() => setRoomNumber(room.number)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 h-11 rounded-lg border text-left transition-colors duration-150",
                      selected
                        ? "border-brand-orange bg-brand-orange-50"
                        : room.allowed
                          ? "border-grey-200 hover:border-grey-300 bg-white"
                          : "border-grey-200 bg-grey-50 cursor-not-allowed opacity-60",
                    )}
                  >
                    <BedDouble className="size-4 text-grey-400 shrink-0" />
                    <span className="tabular font-medium text-ink-900">{room.number}</span>
                    <span className="ml-auto">
                      <StatusPill
                        tone={
                          room.label ? "warning"
                            : room.housekeeping === "inspected" ? "success"
                            : room.housekeeping === "clean" ? "info"
                            : room.housekeeping === "dirty" ? "warning"
                            : "neutral"
                        }
                      >
                        {room.label ?? room.housekeeping}
                      </StatusPill>
                    </span>
                  </button>
                );
                return (
                  <li key={room.number}>
                    {room.reason ? <Tooltip content={room.reason}>{body}</Tooltip> : body}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="space-y-4 pt-4 border-t border-grey-200">
            <p className="text-sm text-grey-600">
              Indian properties must record a guest's identity document. It can
              be skipped, but the reason is kept in the stay's note.
            </p>
            <WaitingDetailsLink reference={stay.reference} />
            <GuestIdFields value={guestId} onChange={setGuestId} today={businessDate} />
          </section>

          <section className="space-y-4 pt-4 border-t border-grey-200">
            <Field label="Meal plan">
              {({ id: f }) => (
                <NativeSelect id={f} value={ratePlan} onChange={(e) => setRatePlan(e.target.value)}>
                  {mealPlanChoices(ratePlan).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </NativeSelect>
              )}
            </Field>
            {/* ── ARRIVING EARLY ─────────────────────────────────
                Shown only when the property says so, against the property's
                clock; the server refuses independently either way. */}
            {isEarly && (
              <div className="rounded-lg border border-brand-yellow-100 bg-brand-yellow-50 p-3 space-y-2.5">
                <p className="text-sm text-[#8a6300]">
                  {earlyByDate
                    ? `This booking is for ${dateShort(stay.arrival)}. Checking `
                      + "in now moves it to today, so tonight is charged."
                    : `Rooms are ready from ${early.data?.checkInTime ?? ""}.`}
                  {earlyByClock && (early.data?.charge == null
                    ? " This property does not charge for an early arrival."
                    : ` An early arrival is ${money(early.data.charge)}.`)}
                </p>
                <Field label="Why the room is being given early" required>
                  {({ id: f }) => (
                    <Input id={f} value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)}
                      placeholder="Overnight train, room vacant and clean" />
                  )}
                </Field>
                {/* THE WAIVE IS A MANAGER'S, by the server's own mayWaive, and
                    refused again there. */}
                {earlyByClock && early.data?.charge != null && early.data.mayWaive && (
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={waiveEarly}
                      onChange={(e) => setWaiveEarly(e.target.checked)}
                      className="mt-0.5 size-4 accent-brand-orange cursor-pointer" />
                    <span className="text-sm text-[#8a6300]">
                      Waive the charge.{" "}
                      <span className="text-grey-600">
                        The reason is still recorded, and its absence from the bill is visible.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
            <div className="rounded-lg bg-grey-50 border border-grey-200 p-3 space-y-1.5">
              {/* A dash when the room type has no rate - never ₹0 (defect 246). */}
              <Line label="Rack rate" value={stay.rackTariff === null ? "-" : money(stay.rackTariff)} muted />
              <Line label="Offered" value={stay.isComplimentary ? "Complimentary" : money(stay.offeredTariff)} bold />
              <Line label="Nights" value={String(stay.nights)} muted />
            </div>
            <Switch
              checked={offersAgreed}
              onCheckedChange={setOffersAgreed}
              label="Guest agreed to offers"
              description="Ask them. Unticked, no offers are sent. Kept against their phone and email at every hotel of the group."
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({
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
