import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogIn, BedDouble, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import {
  Button, Field, Input, NativeSelect, StatusPill, Switch, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger,
} from "@/components/ui";
import { checkIn, assignableRooms, checkInAllowed, earlyArrival, expressCheckIn, mealPlanChoices } from "@/modules/front-desk/data/operations";
import { type Stay } from "@/data/repositories";
import {
  BookingSiteBlacklist, GuestIdFields, guestIdState, guestIdPayload, noGuestId, type GuestId,
} from "@/modules/guests";
import { countProblem } from "../../../../api/src/validate.ts";
import { AddIdPhotoAtDesk, WaitingDetailsLink } from "@/modules/online-checkin";
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
  /* THE ONE PAGE (D27-236 3.1-3.3): the party, the meal plan and the room
     are shown as they stand, each with Change; the grid opens only when
     needed. */
  const [changing, setChanging] = useState<{ party?: boolean; plan?: boolean; room?: boolean }>({});
  /* EXPRESS (D27-236 3.4, D27-242): the server says whether this stay's ID
     was confirmed from its own online check-in; "Use a different ID" opens
     the fields again. */
  const express = useQuery({
    queryKey: ["express-check-in", hotelId, stay.id],
    queryFn: () => expressCheckIn(hotelId, stay.id),
    enabled: open,
  });
  const [otherId, setOtherId] = useState(false);
  const byExpress = (express.data?.express ?? false) && !otherId;

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
      ?? (byExpress ? null : id.blocked)
      ?? (isEarly && !earlyReason.trim() ? "Say why the room is being given early." : null);

  const reset = () => {
    setAdults(String(stay.adults)); setChildren(String(stay.children));
    setRoomNumber(stay.roomNumber); setGuestId(noGuestId(stay.nationality ?? "IN"));
    setEarlyReason(""); setWaiveEarly(false); setOffersAgreed(false); setRatePlan(stay.ratePlan);
    setConfirming(false); setChanging({}); setOtherId(false);
  };

  const submit = async () => {
    setBusy(true);
    const res = await checkIn(hotelId, stay.id, {
      roomNumber, adults, children, ratePlan,
      /* The nationality always - with the ID skipped too, or a foreign
         guest never reached the Form III register; the document only when
         a type and a number were both typed. */
      /* By express the nationality only: the server checks the confirmed
         document itself (D27-242). */
      ...guestIdPayload(byExpress ? noGuestId(stay.nationality ?? "IN") : guestId),
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
        size="lg"
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

        {/* LAID OUT LIKE NEW BOOKING (the owner's D27-236 3.1-3.3): the room,
            the ID, an early arrival and offers on the left; the stay - its
            dates, the party, the meal plan and the rate - on the right. */}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-5 min-w-0">
            <section className="space-y-2" data-checkin-room>
              {chosen && chosen.allowed && !changing.room ? (
                <>
                  <div className="flex items-center gap-3">
                    <p className="text-base text-ink-900">
                      <span className="font-medium">Room {chosen.number}</span>
                      <span className="text-grey-600"> · {chosen.label ?? cap(chosen.housekeeping)}</span>
                    </p>
                    <Button variant="secondary" size="sm" className="ml-auto"
                      onClick={() => setChanging((c) => ({ ...c, room: true }))}>
                      Change room
                    </Button>
                  </div>
                  {/* Who has not left yet - the grid's tooltip said it. */}
                  {chosen.reason && (
                    <p className="text-sm text-warning-dark" data-checkin-room-reason>{chosen.reason}</p>
                  )}
                </>
              ) : (
                <>
                  <Explained title="Room">
                    Only a clean or inspected room can take a guest; the rest are shown with the reason.
                  </Explained>
                  {/* One column on a phone: two cut "inspected" off at 390 px. */}
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto scrollbar-quiet">
                    {(rooms.data ?? []).map((room) => {
                      const selected = room.number === roomNumber;
                      const body = (
                        <button
                          type="button"
                          disabled={!room.allowed}
                          onClick={() => { setRoomNumber(room.number); setChanging((c) => ({ ...c, room: false })); }}
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
                </>
              )}
            </section>

            <section className="space-y-4 pt-4 border-t border-grey-200" data-checkin-id>
              {byExpress ? (
                <div className="flex items-center gap-3" data-checkin-express>
                  <p className="text-base text-ink-900">
                    ID confirmed from online check-in:{" "}
                    <span className="font-medium">{idWord(express.data!.document!.type)} {express.data!.document!.number}</span>
                  </p>
                  <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setOtherId(true)}>
                    Use a different ID
                  </Button>
                </div>
              ) : (
                <>
                  <Explained title="ID">
                    Indian properties must record a guest's identity document. It can be skipped, but the reason is kept in the stay's note.
                  </Explained>
                  <WaitingDetailsLink reference={stay.reference} />
                  <GuestIdFields value={guestId} onChange={setGuestId} today={businessDate} />
                </>
              )}
              {/* D27-210: the desk adds the ID photo for a guest who sent none. */}
              <AddIdPhotoAtDesk stayId={stay.id} />
            </section>

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

            <Switch
              checked={offersAgreed}
              onCheckedChange={setOffersAgreed}
              label="Guest agreed to offers"
              description="Ask them. Unticked, no offers are sent. Kept against their phone and email at every hotel of the group."
            />
          </div>

          <aside className="space-y-3 rounded-lg bg-grey-50 border border-grey-200 p-3 h-fit" data-checkin-stay>
            <p className="text-sm text-ink-900">
              {dateShort(stay.arrival)} – {dateShort(stay.departure)}
              <span className="text-grey-500"> · {stay.isDayUse ? "day use" : `${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`}</span>
            </p>
            {changing.party ? (
              <div className="grid grid-cols-2 gap-2">
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
            ) : (
              <Changeable what="adults and children" onChange={() => setChanging((c) => ({ ...c, party: true }))}>
                {adultsText} adult{adults === 1 ? "" : "s"} · {childrenText} {children === 1 ? "child" : "children"}
              </Changeable>
            )}
            {partyWrong && (
              <p className="text-sm text-brand-red-700" data-party-wrong>{partyWrong}</p>
            )}
            {changing.plan ? (
              <Field label="Meal plan">
                {({ id: f }) => (
                  <NativeSelect id={f} value={ratePlan} onChange={(e) => setRatePlan(e.target.value)}>
                    {mealPlanChoices(ratePlan).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
            ) : (
              <Changeable what="meal plan" onChange={() => setChanging((c) => ({ ...c, plan: true }))}>
                {mealPlanChoices(ratePlan).find((p) => p.value === ratePlan)?.label ?? ratePlan}
              </Changeable>
            )}
            <div className="pt-2 border-t border-grey-200 space-y-1.5">
              {/* A dash when the room type has no rate - never ₹0 (defect 246). */}
              <Line label="Rack rate" value={stay.rackTariff === null ? "-" : money(stay.rackTariff)} muted />
              <Line label="Offered" value={stay.isComplimentary ? "Complimentary" : money(stay.offeredTariff)} bold />
            </div>
          </aside>
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

/** A fact as it stands, with its Change (D27-236 3.1). */
function Changeable({ what, children, onChange }: { what: string; children: React.ReactNode; onChange: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-sm text-ink-900 min-w-0">{children}</p>
      <button type="button" onClick={onChange} aria-label={`Change ${what}`}
        className="ml-auto text-sm font-medium text-brand underline-offset-2 hover:underline">
        Change
      </button>
    </div>
  );
}

/** A section's name, its explanation behind (i) (D27-236 3.3). */
function Explained({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none text-sm font-medium text-ink-900">
        {title}
        <Info className="size-3.5 text-grey-400" aria-label={`About ${title.toLowerCase()}`} />
      </summary>
      <p className="mt-1 text-sm text-grey-600">{children}</p>
    </details>
  );
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const ID_WORDS: Record<string, string> = {
  aadhaar: "Aadhaar", passport: "Passport", driving_licence: "Driving licence", voter: "Voter ID", other: "ID",
};
const idWord = (t: string) => ID_WORDS[t] ?? t;
