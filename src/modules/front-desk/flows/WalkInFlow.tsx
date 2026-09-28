import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rateOverrideNeedsReason, canConfirmWalkIn } from "@/lib/rules";
import {
  Button, Field, Input, NativeSelect, Switch, toast,
  Dialog, DialogContent,
} from "@/components/ui";
import { createWalkIn } from "@/modules/front-desk/data/operations";
import { getRoom } from "@/data/repositories";
import { MARKET_SEGMENTS } from "@/modules/reservations";
import {
  ReturningGuest, ConsentTicks, ForeignGuestFields, formIIIMissing,
  particularsPayload, NO_PARTICULARS, ID_TYPES, idProblem, idExpired, type Particulars,
} from "@/modules/guests";
import {
  countProblem, emailProblem, MAX_NIGHTS, phoneProblem,
} from "../../../../api/src/validate.ts";

/* ══════════════════════════════════════════════════════════════════
   FLOW D — the walk-in at 23:40

   The hardest and most common flow at these properties, and the one
   most systems get wrong by treating it as a booking followed by a
   check-in. It is ONE act, and it ends in one button.

   The guest is typed once. A returning guest is recognised by their
   PHONE OR EMAIL, never by their name (the owner, 21 September): the
   list that used to open under the name matched anybody sharing a
   surname, at this hotel only, and picking from it still made a new
   guest record - a duplicate. Now the phone or email suggests "stayed
   with the group N times - same person?", and the clerk decides.
   ══════════════════════════════════════════════════════════════════ */

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
  /* Optional, like the booking form's. They let a returning guest be
     suggested, a blacklisted one warned of, and the two ticks be kept
     against something (D21-20, D21-21, D21-72, D21-22). */
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [returning, setReturning] = useState<{ id: string; name: string } | null>(null);
  const [whatsapp, setWhatsapp] = useState(false);
  const [offersAgreed, setOffersAgreed] = useState(false);
  /* As typed (FD-6): "-2" used to become 1 night without a word. */
  const [nights, setNights] = useState("1");
  /* NO GUARD MEANT A DOUBLE PRESS BOOKED TWICE. The button stayed live
     through the request, so two taps sent two walk-ins: the first put
     a guest in the room and the second came back "Somebody is already
     in that room" — the desk saw only the refusal and believed nothing
     had happened, while a guest was checked in behind it.

     A room is a scarce resource and this flow takes it in one act, so
     it is exactly the button that must not be pressable twice. */
  const [busy, setBusy] = useState(false);
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
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
  /* Form III (D27-25; the owner, 27 September: what check-in asks). A
     foreign walk-in never reached the register - this form had no
     nationality, and a guest defaults to IN. */
  const [nationality, setNationality] = useState("IN");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idSkipReason, setIdSkipReason] = useState("");
  const [particulars, setParticulars] = useState<Particulars>(NO_PARTICULARS);
  const isForeign = (nationality.trim().toUpperCase() || "IN") !== "IN";
  const idCaptured = Boolean(idType && idNumber.trim());
  const formIIINeeds = isForeign ? formIIIMissing(particulars, nationality, idCaptured) : [];
  /* FD-1 (QA, 28 September): the ID step is every guest's, as on the
     Arrivals check-in - a document, or a reason for skipping it. */
  const idNeeded = !idCaptured && !idSkipReason.trim();
  /* The server's own rules (validate.ts), said here first (round D). */
  const typedWrong = countProblem(Number(nights), "Nights", 1, MAX_NIGHTS)
    ?? countProblem(Number(adults), "Adults", 1) ?? countProblem(Number(children), "Children", 0)
    ?? phoneProblem(phone) ?? emailProblem(email)
    ?? idProblem(particulars, idType, idNumber, nationality, date);
  /* GU-2: an expired passport or visa is warned of, then recorded as typed. */
  const expired = isForeign ? idExpired(particulars, date) : [];
  const [expiredOk, setExpiredOk] = useState(false);
  const nightsN = Number(nights) || 0;

  /* Derived, never stored. The party is what the two counters say and
     the capacity is what the room type says — neither is a third
     number anybody can set, which is how the two would drift. */
  const party = Math.max(1, Number(adults) || 0) + Math.max(0, Number(children) || 0);

  const room = useQuery({
    queryKey: ["room", hotelId, roomNumber],
    queryFn: () => getRoom(hotelId, roomNumber),
    enabled: open && !!roomNumber,
  });
  const overCapacity =
    room.data !== null && room.data !== undefined
    && party > room.data.maxOccupancy;

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
    guestName, nights: nightsN, offeredTariff: offered, rackTariff: rack ?? offered,
    overrideReason,
  });

  const reset = () => {
    setGuestName(""); setNights("1"); setAdults("2"); setChildren("0");
    setPhone(""); setEmail(""); setReturning(null);
    setWhatsapp(false); setOffersAgreed(false);
    setRatePlan("CP"); setRate(""); setOverrideReason("");
    /* Cleared too. A source left over from the last walk-in would be
       attributed to the next guest, silently, and nobody would find it. */
    setSegment(""); setBusinessSource(""); setSalesPerson("");
    setSingleLady(false);
    setNationality("IN"); setIdType(""); setIdNumber(""); setIdSkipReason("");
    setParticulars(NO_PARTICULARS); setExpiredOk(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent
        title="Walk-in"
        description={`Room ${roomNumber} · arriving ${date}`}
      >
        <div className="space-y-4">
          <Field label="Guest" required>
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" hint="Optional">
              {({ id }) => (
                <Input id={id} type="tel" value={phone}
                  onChange={(e) => { setPhone(e.target.value); setReturning(null); }} />
              )}
            </Field>
            <Field label="Email" hint="Optional">
              {({ id }) => (
                <Input id={id} type="email" value={email}
                  onChange={(e) => { setEmail(e.target.value); setReturning(null); }} />
              )}
            </Field>
          </div>

          <ReturningGuest hotelId={hotelId} phone={phone} email={email}
            chosen={returning} onChoose={setReturning} />

          <Field label="Nationality"
            hint="Anything other than IN puts this stay on the Form III register.">
            {({ id }) => (
              <Input id={id} value={nationality} placeholder="IN" maxLength={2}
                className="w-24"
                onChange={(e) => setNationality(e.target.value.toUpperCase())} />
            )}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Document">
              {({ id }) => (
                <NativeSelect id={id} value={idType}
                  onChange={(e) => setIdType(e.target.value)}>
                  <option value="">Not recorded</option>
                  {ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Number" required={Boolean(idType)}>
              {({ id }) => (
                <Input id={id} value={idNumber} disabled={!idType}
                  onChange={(e) => setIdNumber(e.target.value)} />
              )}
            </Field>
          </div>
          {!idCaptured && (
            <Field label="Reason for skipping" required>
              {({ id }) => (
                <Input id={id} value={idSkipReason}
                  onChange={(e) => setIdSkipReason(e.target.value)} />
              )}
            </Field>
          )}
          {isForeign && (
            <ForeignGuestFields value={particulars} onChange={setParticulars}
              nationality={nationality} idCaptured={idCaptured} />
          )}
          {expired.length > 0 && (
            <Switch checked={expiredOk} onCheckedChange={setExpiredOk}
              label="Check in anyway"
              description={`${expired.join(" ")} It is recorded as typed.`} />
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
              "rounded-lg border p-3 text-sm",
              overCapacity
                ? "border-brand-red-100 bg-brand-red-50 text-brand-red-700"
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
                  id={id} numeric value={nights}
                  onChange={(e) => setNights(e.target.value)}
                />
              )}
            </Field>
            <Field label="Adults">
              {({ id }) => (
                <Input
                  id={id} numeric value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                />
              )}
            </Field>
            <Field label="Children">
              {({ id }) => (
                <Input
                  id={id} numeric value={children}
                  onChange={(e) => setChildren(e.target.value)}
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
                  <option value="">-</option>
                  {MARKET_SEGMENTS.map((m) => <option key={m}>{m}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Business source" hint="Agent, company, planner">
              {({ id }) => (
                <Input
                  id={id}
                  value={businessSource}
                  onChange={(e) => setBusinessSource(e.target.value)}
                  placeholder="-"
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
                placeholder="-"
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

          <ConsentTicks whatsapp={whatsapp} onWhatsapp={setWhatsapp}
            offersAgreed={offersAgreed} onOffersAgreed={setOffersAgreed} />

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
            <div className="rounded-lg border border-brand-yellow-100 bg-brand-yellow-50 p-3 space-y-2.5">
              <p className="flex items-start gap-2 text-sm text-[#8a6300]">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  {money((rack ?? 0) - offered)} below rack - {" "}
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

          <div className="rounded-lg bg-grey-50 border border-grey-200 p-3 space-y-1">
            <Row label={`${nightsN} night${nightsN === 1 ? "" : "s"} × ${money(offered)}`} value={money(offered * nightsN)} />
            <Row label="Tax 5%" value={money(Math.round(offered * nightsN * 0.05 * 100) / 100)} muted />
            <div className="pt-1 border-t border-grey-200">
              <Row label="Total" value={money(Math.round(offered * nightsN * 1.05 * 100) / 100)} bold />
            </div>
          </div>

          {!permitted.allowed && permitted.reason && (
            <p className="text-xs text-brand-red-700">{permitted.reason}</p>
          )}
          {typedWrong && (
            <p className="text-xs text-brand-red-700" data-walkin-wrong>{typedWrong}</p>
          )}
          {idNeeded && (
            <p className="text-xs text-grey-600">
              Record the ID document - type and number - or give a reason for skipping it.
            </p>
          )}
          {/* Rule 6: the button says why it is blocked. */}
          {formIIINeeds.length > 0 && (
            <p className="text-xs text-grey-600" data-form-iii-needs>
              Form III still needs: {formIIINeeds.join(", ")}.
            </p>
          )}

          {/* ONE action. Not "book" then "check in". */}
          <Button variant="primary"
            className="w-full"
            /* Over capacity blocks it here too. The server refuses
               independently, but a clerk should find out while the
               family is still standing there and a bigger room can be
               chosen -- not after pressing the one button. */
            disabled={!permitted.allowed || overCapacity || busy
                      || formIIINeeds.length > 0 || idNeeded || typedWrong !== null
                      || (expired.length > 0 && !expiredOk)}
            data-walkin-confirm
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              const res = await createWalkIn(hotelId, {
                guestName, roomNumber, nights: nightsN, adults: Number(adults),
                children: Number(children), ratePlan,
                rackTariff: rack ?? offered, offeredTariff: offered,
                overrideReason, businessDate: date,
                businessSource, marketSegment: segment, salesPerson,
                isSingleLady: singleLady,
                phone, email,
                ...(returning ? { guestId: returning.id } : {}),
                whatsappAgreed: whatsapp, offersAgreed,
                nationality,
                /* The document for every guest (FD-1); Form III's particulars
                   and visit for a foreigner. */
                ...(idCaptured
                  ? { identity: { idType, idNumber: idNumber.trim(),
                                  ...(isForeign ? particularsPayload(particulars).identity : {}) } }
                  : { idSkipReason }),
                ...(isForeign ? { visit: particularsPayload(particulars).visit } : {}),
              });
              setBusy(false);
              if (res.ok) {
                toast.success(
                  /* The name as it stands on file - the returning guest's,
                     when the clerk said "same person". */
                  `${res.data?.guest ?? guestName} is in house`,
                  `Room ${roomNumber} · ${nightsN} night${nightsN === 1 ? "" : "s"}`,
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
