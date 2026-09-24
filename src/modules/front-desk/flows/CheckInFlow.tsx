import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogIn, BedDouble, Users, Sparkle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import {
  Button, Field, Input, NativeSelect, StatusPill, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger, Term,
} from "@/components/ui";
import { checkIn, assignableRooms, checkInAllowed, earlyArrival } from "@/modules/front-desk/data/operations";
import { type Stay } from "@/data/repositories";
import { BookingSiteBlacklist } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   FLOW A — arrival to in house

   Five steps, in the order a clerk actually works: confirm the party,
   assign a room, capture ID, confirm the rate, done.

   Only clean or inspected rooms are offered. A dirty room appears in
   the list, disabled, with the reason — hiding it would teach nobody
   why they cannot use it.
   ══════════════════════════════════════════════════════════════════ */

const STEPS = ["Guest", "Room", "ID", "Rate", "Done"] as const;

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
  const [step, setStep] = useState(0);

  const [adults, setAdults] = useState(stay.adults);
  const [children, setChildren] = useState(stay.children);
  const [roomNumber, setRoomNumber] = useState(stay.roomNumber);
  /* The document itself. This was `idCaptured: boolean` — a toggle that
     said a passport had been looked at and stored nothing. */
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [nationality, setNationality] = useState("IN");
  const [passportExpiry, setPassportExpiry] = useState("");
  const [visaNumber, setVisaNumber] = useState("");
  const [visaExpiry, setVisaExpiry] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [idSkipReason, setIdSkipReason] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [waiveEarly, setWaiveEarly] = useState(false);

  /* Captured means a TYPE and a NUMBER. Derived, never asserted — the
     server derives it the same way and cannot be told otherwise. */
  const idCaptured = Boolean(idType && idNumber.trim());
  const isForeign = nationality.trim().toUpperCase() !== "IN";
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

  const allowed = (permitted.data?.allowed ?? false) || earlyByDate;
  const reason = permitted.data?.reason;

  /* THE REASON, not just a dead button. `canCheckIn` produces a real
     sentence — "Arrival is 30 Aug 2026. Check-in opens on the arrival
     date." — and the trigger used to throw it away, leaving a clerk
     with a greyed control and nothing to act on.

     Rule 6, which this project states as: a blocked action is shown
     WITH ITS REASON. A disabled button on its own is the half of that
     rule that helps nobody. */
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
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setStep(0); }}
    >
      <DialogTrigger asChild>
        {/* NO TOOLTIP. It carried the same sentence the paragraph
            below the button now shows, so the reason appeared twice —
            once on hover and once in the panel. And a tooltip needs a
            pointer: on the tablet at the front desk it can never be
            opened at all, which makes it the wrong half to keep. */}
        {trigger}
      </DialogTrigger>

      <DialogContent
        title={`Check in ${stay.guest}`}
        description={`${stay.reference} · ${stay.roomType}`}
      >
        {/* CRM-3 (D22-8): a booking site's guest on a blacklisted phone or email. */}
        <div className="mb-4 empty:hidden">
          <BookingSiteBlacklist hotelId={hotelId} from={stay.arrival} to={stay.arrival} stayIds={[stay.id]} />
        </div>
        <Stepper current={step} />

        <div className="mt-5 min-h-[220px]">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                Confirm who is actually arriving. The booking says{" "}
                {stay.adults} adult{stay.adults === 1 ? "" : "s"}
                {stay.children ? `, ${stay.children} child` : ""}.
              </p>
              <div className="grid grid-cols-2 gap-3">
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
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-grey-600">
                Only a clean or inspected room can take a guest. The rest are
                shown with the reason.
              </p>
              <ul className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto scrollbar-quiet">
                {(rooms.data ?? []).map((room) => {
                  const selected = room.number === roomNumber;
                  const body = (
                    <button
                      type="button"
                      disabled={!room.allowed}
                      onClick={() => setRoomNumber(room.number)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 h-11 rounded-md border text-left transition-colors duration-150",
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
                            room.housekeeping === "inspected" ? "success"
                              : room.housekeeping === "clean" ? "info"
                              : room.housekeeping === "dirty" ? "warning"
                              : "neutral"
                          }
                        >
                          {room.housekeeping}
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
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                Indian properties must record a guest's identity document.
                It can be skipped, but the reason is kept in the stay's note.
              </p>

              <Field
                label="Nationality"
                hint={<>Anything other than IN puts this stay on the <Term name="formC">Form C</Term> register.</>}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value.toUpperCase())}
                    placeholder="IN"
                    maxLength={2}
                    className="w-24"
                  />
                )}
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Document">
                  {({ id }) => (
                    <NativeSelect
                      id={id}
                      value={idType}
                      onChange={(e) => setIdType(e.target.value)}
                    >
                      <option value="">Not recorded</option>
                      {/* Exactly the types gd_id_type_valid permits. A
                          fifth option here would be refused by the
                          database as a constraint name. */}
                      <option value="passport">Passport</option>
                      <option value="aadhaar">Aadhaar</option>
                      <option value="driving_licence">Driving licence</option>
                      <option value="voter">Voter ID</option>
                      <option value="other">Other</option>
                    </NativeSelect>
                  )}
                </Field>

                <Field label="Number" required={Boolean(idType)}>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      placeholder={idType === "passport" ? "P1234567" : "Document number"}
                      disabled={!idType}
                    />
                  )}
                </Field>
              </div>

              {/* Only for a foreign national. Asking an Indian guest for a
                  visa number is how a form teaches people to leave fields
                  blank. */}
              {isForeign && (
                <div className="space-y-3 border-l-2 border-brand-yellow pl-3.5">
                  <p className="text-2xs text-grey-600">
                    A foreign national must be reported to the FRRO within 24
                    hours of arrival. These fields go on that filing.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Passport expiry">
                      {({ id }) => (
                        <Input id={id} type="date" value={passportExpiry}
                          onChange={(e) => setPassportExpiry(e.target.value)} />
                      )}
                    </Field>
                    <Field label="Visa number">
                      {({ id }) => (
                        <Input id={id} value={visaNumber}
                          onChange={(e) => setVisaNumber(e.target.value)} />
                      )}
                    </Field>
                    <Field label="Visa expiry">
                      {({ id }) => (
                        <Input id={id} type="date" value={visaExpiry}
                          onChange={(e) => setVisaExpiry(e.target.value)} />
                      )}
                    </Field>
                    <Field label="Address abroad">
                      {({ id }) => (
                        <Input id={id} value={addressLine}
                          onChange={(e) => setAddressLine(e.target.value)} />
                      )}
                    </Field>
                  </div>
                </div>
              )}

                {!idCaptured && (
                  <Field label="Reason for skipping" required>
                    {({ id }) => (
                    <Input
                      id={id}
                      value={idSkipReason}
                      onChange={(e) => setIdSkipReason(e.target.value)}
                      placeholder="Scanner offline - to be captured at breakfast"
                    />
                  )}
                </Field>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Field label="Meal plan">
                {({ id }) => (
                  <NativeSelect
                    id={id}
                    value={ratePlan}
                    onChange={(e) => setRatePlan(e.target.value)}
                  >
                    {["CP", "Room Only", "EP", "MAP"].map((p) => <option key={p}>{p}</option>)}
                  </NativeSelect>
                )}
              </Field>
              {/* ── ARRIVING EARLY ─────────────────────────────────
                  Shown only when the property says so. `isEarly` comes
                  from the SERVER, against the property's clock — a
                  tablet with the wrong time set must not be able to
                  make an early arrival look like an ordinary one, and
                  the server refuses independently either way. */}
              {isEarly && (
                <div className="rounded-md border border-brand-yellow-200 bg-brand-yellow-50 p-3 space-y-2.5">
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
                    {({ id }) => (
                      <Input
                        id={id}
                        value={earlyReason}
                        onChange={(e) => setEarlyReason(e.target.value)}
                        placeholder="Overnight train, room vacant and clean"
                      />
                    )}
                  </Field>
                  {/* THE WAIVE IS A MANAGER'S. Shown only to somebody
                      the server says may waive (rule C: its own mayWaive,
                      not a role list here) — and refused again on the
                      server, because a hidden checkbox is a courtesy and
                      not a permission. */}
                  {earlyByClock && early.data?.charge != null && early.data.mayWaive && (
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={waiveEarly}
                        onChange={(e) => setWaiveEarly(e.target.checked)}
                        className="mt-0.5 size-4 accent-brand-orange cursor-pointer"
                      />
                      <span className="text-sm text-[#8a6300]">
                        Waive the charge.
                        {" "}
                        <span className="text-grey-600">
                          The reason is still recorded, and its absence
                          from the bill is visible.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1.5">
                {/* A dash when the room type has no rate — never ₹0
                    (defect 246). */}
                <Line
                  label="Rack rate"
                  value={stay.rackTariff === null ? "-" : money(stay.rackTariff)}
                  muted
                />
                <Line
                  label="Offered"
                  value={stay.isComplimentary ? "Complimentary" : money(stay.offeredTariff)}
                  bold
                />
                <Line
                  label="Nights"
                  value={String(stay.nights)}
                  muted
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-6 space-y-3">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-success-50">
                <Sparkle className="size-5 text-success" />
              </div>
              <p className="text-md font-semibold text-ink-900">Ready to check in</p>
              <div className="text-sm text-grey-600 space-y-0.5">
                <p>{stay.guest} · room {roomNumber}</p>
                <p className="tabular">
                  <Users className="inline size-3.5 -mt-0.5 mr-1" />
                  {adults} adult{adults === 1 ? "" : "s"}{children ? `, ${children} child` : ""} · {ratePlan}
                </p>
                {idCaptured ? (
                  /* What was actually recorded. This showed NOTHING when a
                     document HAD been captured, so a clerk confirming a
                     check-in could not see the passport number they had
                     just typed — the one screen where checking it is free. */
                  <p className="tabular">
                    {idType === "driving_licence"
                      ? "Driving licence"
                      : idType.charAt(0).toUpperCase() + idType.slice(1)}
                    {" "}{idNumber}
                    {isForeign ? " · " + nationality : ""}
                  </p>
                ) : (
                  <p className="text-brand-yellow">
                    ID not captured - {idSkipReason}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 pt-4 border-t border-grey-200">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </Button>

          {step < 4 ? (
            <Button
              disabled={
                (step === 2 && !idCaptured && !idSkipReason.trim())
                /* The server refuses without it anyway. Disabling here
                   too means the clerk finds out on the step that asks,
                   not on the one that finishes. */
                || (step === 3 && isEarly && !earlyReason.trim())
              }
              onClick={() => setStep((s) => s + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={async () => {
                const res = await checkIn(hotelId, stay.id, {
                  roomNumber, adults, children, ratePlan,
                  /* Sent only when there is something to send. An empty
                     object would look like a capture to anything counting
                     keys rather than reading them. */
                  ...(idCaptured
                    ? {
                        identity: {
                          idType, idNumber: idNumber.trim(), nationality,
                          ...(passportExpiry ? { passportExpiry } : {}),
                          ...(visaNumber ? { visaNumber } : {}),
                          ...(visaExpiry ? { visaExpiry } : {}),
                          ...(addressLine ? { addressLine } : {}),
                        },
                      }
                    : {}),
                  idSkipReason, businessDate,
                  /* Asked for on the Rate step, and never sent until 24
                     September - so the server refused every check-in
                     before the check-in hour. */
                  earlyReason, waiveEarly,
                });
                if (res.ok) {
                  toast.success(
                    `${stay.guest} is in house`,
                    `Room ${roomNumber} · the arrivals count has dropped.`,
                  );
                  setOpen(false);
                  setStep(0);
                  qc.invalidateQueries();
                  onDone?.();
                } else {
                  toast.error("Could not check in", res.reason);
                }
              }}
            >
              <Check className="size-4" />
              Check in
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1 flex-1 last:flex-none">
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 h-6 rounded-full text-2xs font-medium whitespace-nowrap",
              i < current ? "bg-success-50 text-success-600"
                : i === current ? "bg-ink-900 text-white"
                : "bg-grey-100 text-grey-500",
            )}
          >
            {i < current ? <Check className="size-3" /> : <span className="tabular">{i + 1}</span>}
            {label}
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn("h-px flex-1", i < current ? "bg-success" : "bg-grey-200")} />
          )}
        </li>
      ))}
    </ol>
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
