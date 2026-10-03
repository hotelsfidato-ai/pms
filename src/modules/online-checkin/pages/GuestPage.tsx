import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import RoomDining from "@/modules/online-checkin/RoomDining";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateLong, dateTime } from "@/lib/format";
import {
  Button, Card, CardBody, Field, fieldProps, Input, NativeSelect, Segmented, StatusPill, Textarea,
} from "@/components/ui";
import {
  dropUnlock, getBill, getDetails, getIdPhoto, getRequests, logoAddress, makeRequest, openGuestPage,
  sendCode, sendDetails, sendIdPhoto, verifyCode, type Details, type GuestPageView,
} from "@/modules/online-checkin/data/guestPage";
import { continueWithGoogle } from "@/modules/online-checkin/googleRedirect";
import { IdPhotoInputs, type ChosenPhotos } from "@/modules/online-checkin/IdPhotoInputs";
import { idPhotoNotice } from "@/modules/online-checkin/idPhotoNotice";
import { shrinkPhoto } from "@/modules/online-checkin/shrinkPhoto";
import { GENDERS, LABELS, PURPOSES } from "@/modules/online-checkin/formIII";
import {
  H2, LEAD, NOTHING_HERE, SECTION, messageFrom, unlockGone, useUnlockGone,
} from "@/modules/online-checkin/guestKit";
import { privacyNoticeFor } from "@/modules/online-checkin/privacyNotice";
import { MessageTheDesk } from "@/modules/online-checkin/MessageTheDesk";
import { QuickChoices, hasQuickChoices } from "@/modules/online-checkin/QuickChoices";
import { TableBookingSection } from "@/modules/online-checkin/TableBooking";
import { DigiLockerButton } from "@/modules/online-checkin/DigiLockerButton";
import { WakeUpSection } from "@/modules/online-checkin/WakeUpSection";
import { GallerySection } from "@/modules/online-checkin/GallerySection";
import { BillPrint } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PAGE — /g/:token

   THE ONE SCREEN IN THIS SYSTEM OPENED BY SOMEBODY THE HOTEL DOES NOT
   EMPLOY. It is outside the signed-in shell: no sidebar, no menu, no
   property picker, nothing that belongs to staff.

   Two kinds of link open it (D21-7): a booking's own, and a room's fixed
   card. Before the six digits:
     · a booking's link shows what a clerk would say across the counter -
       the guest's own name, their dates, the last four digits of the
       number the booking carries;
     · a room card shows the hotel and the room number, and nothing of
       whoever is staying there (D21-14); an empty room says only that it
       opens once you are checked in (D21-15).

   Behind the code - their details, their requests - every call carries
   THIS TAB's unlock (D21-6), and the server asks for it every time. This
   screen deciding what to draw is not a guard.

   ⚠ A WRONG NUMBER AND A RIGHT ONE LOOK THE SAME HERE TOO. The door
   answers both with one sentence; this prints it and works out nothing
   of its own.

   375px is the primary size: this is read on a phone, usually one
   handed, often on hotel wifi.
   ══════════════════════════════════════════════════════════════════ */

/** A booking with neither a mobile number nor an email - said here without
    asking the door, because the link already shows there is nowhere to send
    a code. */
const NO_WAY = "There is no mobile number or email address on this booking, so "
  + "no code can be sent. Ask the desk.";

export default function GuestPage() {
  const token = useParams().token ?? "";
  const qc = useQueryClient();

  const link = useQuery({
    queryKey: ["guest-page", token],
    queryFn: () => openGuestPage(token),
    retry: false,
  });

  /* The hotel's own name, and nothing after it. The shared title helper
     adds the signed-in property or, for nobody signed in, the group's name
     - and nothing new names the group (D21-27): a guest's tab read
     "5 Elements Akkalkot · Fidato" until it was opened on 21 September. */
  const title = link.data ? link.data.hotel.name : "Your booking";
  useEffect(() => { document.title = title; }, [title]);

  const askAgain = () => {
    dropUnlock(token);
    qc.removeQueries({ queryKey: ["guest-behind", token] });
    void link.refetch();
  };

  if (link.isLoading) {
    return <Shell><Note><p className="text-base text-grey-600">One moment…</p></Note></Shell>;
  }

  /* ⚠ A LINE THAT IS DOWN IS NOT A DEAD LINK (OCI-3, found by opening the
     page while its server was starting). It said "Ask the desk for a new
     one" to a guest on hotel wifi whose link was fine. Nothing reached the
     door, so saying so tells a stranger nothing about the link. */
  if (link.error instanceof ApiError && link.error.status === 0) {
    return (
      <Shell>
        <Note>
          <h1 className="text-xl font-semibold text-ink-900">We could not reach the hotel</h1>
          <p className="text-base text-grey-600 mt-1">Check your connection, then try again.</p>
          <Button variant="primary" className="mt-3.5 w-full" onClick={() => void link.refetch()}>
            Try again
          </Button>
        </Note>
      </Shell>
    );
  }

  /* Every refusal reads the same, because a link that was revoked, one
     that expired and one that never existed must not be told apart. */
  if (link.error || !link.data) {
    return (
      <Shell>
        <Note><h1 className="text-xl font-semibold text-ink-900">{NOTHING_HERE}</h1></Note>
      </Shell>
    );
  }

  const view = link.data;

  /* D21-15, in the owner's words, with the hotel's name and nothing else. */
  if (view.kind === "room" && !view.occupied) {
    return (
      <Shell>
        <Note>
          <p className="text-sm text-grey-600">{view.hotel.name}</p>
          <h1 className="text-xl font-semibold text-ink-900 mt-0.5">
            This opens once you're checked in
          </h1>
        </Note>
      </Shell>
    );
  }

  return (
    <Shell>
      <Heading token={token} view={view} />
      {view.verified ? (
        <Behind token={token} view={view} onUnlockGone={askAgain} />
      ) : view.canSendCodes || view.googleClientId ? (
        <ProveIt token={token} view={view} onVerified={() => void link.refetch()} />
      ) : (
        /* D21-25: nothing can be sent, so nothing is offered - the door's
           own sentence, before anybody types a number. */
        <Note>
          <p className="text-base text-grey-600">
            {view.cannotSend ?? NOTHING_HERE}
          </p>
        </Note>
      )}
    </Shell>
  );
}

function Heading({ token, view }: { token: string; view: GuestPageView }) {
  const { booking } = view;
  return (
    <>
      {/* The large title: the hotel over the guest's name (or the room). */}
      <header className={booking ? "mb-3" : "mb-5"}>
        <Logo token={token} />
        <p className="text-sm text-grey-600">{view.hotel.name}</p>
        <h1 className="page-title text-ink-900 mt-0.5 break-words">
          {booking ? booking.guestName : `Room ${view.room}`}
        </h1>
      </header>
      {booking && (
        /* The stay's facts as rows: label left, value right. */
        <Card className="mb-5">
          <dl className="px-4 divide-y divide-grey-100 text-base">
            {/* A guest already in the room has arrived (QA GP-3). */}
            <Fact label={booking.status === "checked_in" || booking.status === "checked_out" ? "Arrived" : "Arriving"}>
              {dateLong(booking.checkIn)}
            </Fact>
            <Fact label="Leaving">{dateLong(booking.checkOut)}</Fact>
            <Fact label="Booking">{booking.reference}</Fact>
          </dl>
        </Card>
      )}
    </>
  );
}

/* The hotel's logo, else the group's (D27-223), above its name. Decorative:
   the name is printed under it. No logo, or a link that stopped opening, and
   the door answers 404 - the picture goes, rather than a broken one. */
function Logo({ token }: { token: string }) {
  const [gone, setGone] = useState(false);
  const src = useQuery({ queryKey: ["guest-logo", token], queryFn: () => logoAddress(token), staleTime: Infinity });
  if (gone || !src.data) return null;
  return (
    <img src={src.data} alt="" onError={() => setGone(true)}
      className="mb-3 h-10 w-auto max-w-40 object-contain object-left" />
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-grey-600">{label}</dt>
      <dd className="font-medium text-ink-900 tabular text-right">{children}</dd>
    </div>
  );
}

/* ── The privacy notice, BEFORE THE FIRST QUESTION (D21-61) ──────────
   A place for the advisor's words; empty until they are approved
   (`privacyNotice.ts`). */
function Notice({ hotel, className }: { hotel: string; className?: string }) {
  const notice = privacyNoticeFor(hotel);
  if (!notice) return null;
  /* A flat grey-100 tile: it reads on the page and inside a card alike,
     and it is not a card in a card. */
  return (
    <section data-privacy-notice className={cn("rounded-lg bg-grey-100 px-3.5 py-3", className)}>
      <h2 className="text-base font-medium text-ink-900">{notice.heading}</h2>
      <p className="text-sm text-grey-600 mt-1 whitespace-pre-line">{notice.body}</p>
    </section>
  );
}

/* ── Three ways, the guest's choice (D27-207, D27-210) ──────────────
   Nothing is sent on opening, and nothing is typed but a code. The guest
   presses WhatsApp or email and the code goes to what THE BOOKING carries;
   the door says where: the number's last four digits or the address
   masked, and on a room card nothing of either (D21-14). Or they continue
   with Google, and the door checks that the account's address is the
   booking's. */
function ProveIt(
  { token, view, onVerified }:
  { token: string; view: GuestPageView; onVerified: () => void },
) {
  const [code, setCode] = useState("");

  const asked = useMutation({ mutationFn: (by: "whatsapp" | "email") => sendCode(token, by) });
  const answered = useMutation({
    mutationFn: () => verifyCode(token, code),
    onSuccess: (r) => { if (r.verified) onVerified(); },
  });

  /* A booking's link already shows whether the booking has a number or an
     address, so a way that cannot work is not offered. A room card shows
     nothing of the guest: every way is offered, and the door says "Ask the
     desk" for the one the booking lacks. */
  const card = view.kind === "room";
  const byWhatsApp = view.canSendCodes && (card || !!view.phoneHint);
  const byEmail = view.canSendCodes && (card || !!view.emailHint);
  const byGoogle = !!view.googleClientId && (card || !!view.emailHint);
  const byCode = byWhatsApp || byEmail;
  const where = card ? "on WhatsApp or by email, to the phone or the email on the booking" : [
    byWhatsApp && `on WhatsApp to the number on the booking, ending ${view.phoneHint!.replace("…", "")}`,
    byEmail && `by email to ${view.emailHint}`,
  ].filter(Boolean).join(", or ");

  const answer = (e: FormEvent) => { e.preventDefault(); answered.mutate(); };

  return (
    <section className={SECTION}>
      <Notice hotel={view.hotel.name} className="mb-5" />
      <h2 className={H2}>
        Your check-in details are behind a code
      </h2>
      {byCode ? <p className={cn(LEAD, "mb-3")}>We send six digits {where}.</p> : <div className="mb-3" />}

      <Card><CardBody>
        {/* No way at all: the booking has neither, or the server cannot send. */}
        {!byCode && (
          <p className={cn("text-sm text-grey-600", byGoogle && "mb-3")}>
            {view.canSendCodes ? NO_WAY : view.cannotSend}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {byWhatsApp && (
            <Button variant="secondary" disabled={asked.isPending} onClick={() => asked.mutate("whatsapp")}>
              Send the code on WhatsApp
            </Button>
          )}
          {byEmail && (
            <Button variant="secondary" disabled={asked.isPending} onClick={() => asked.mutate("email")}>
              Send the code by email
            </Button>
          )}
          {byGoogle && <WithGoogle token={token} clientId={view.googleClientId!} />}
          {/* DigiLocker, another way in (D27-235); shows nothing while it is off. */}
          {view.digilocker && <DigiLockerButton token={token} />}
          {/* The door's sentence, printed as it came. */}
          <p className="text-sm text-grey-600 empty:hidden" aria-live="polite">
            {asked.isPending ? "Sending the code…"
              : asked.data ? asked.data.message
              : asked.error ? messageFrom(asked.error)
              : null}
          </p>
        </div>
        {/* DEVELOPMENT ONLY (D27-105): the code on screen, from a server
            started to show it. A production build compiles this away, and
            scripts/check-no-dev-login.mjs fails any build that carries it. */}
        {import.meta.env.DEV && asked.data?.devCode && (
          <p className="text-sm text-warning-dark mt-1.5">
            Development only - the code is <span className="font-semibold tabular">{asked.data.devCode}</span>
          </p>
        )}

        {byCode && <form onSubmit={answer} className="mt-3.5 pt-3.5 border-t border-grey-100 flex flex-col gap-3">
          <Field label="The six digits">
            {(f) => (
              <Input
                {...fieldProps(f)}
                inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={answered.isPending || code.trim() === ""}>
            {answered.isPending ? "Checking…" : "Open my booking"}
          </Button>
        </form>}

        {answered.error && (
          <p className="text-sm text-brand-red-700 mt-3">{messageFrom(answered.error)}</p>
        )}
      </CardBody></Card>
    </section>
  );
}

/* ── Continue with Google (D27-207; OCI-10) ──────────────────────────
   Our button, and the whole tab goes to Google's own sign-in page
   (googleRedirect.ts). No script of Google's ever runs here. The answer
   comes back to /g-return (pages/GoogleReturn.tsx), which posts it to the
   door; the door decides. A way in of its own, so another (DigiLocker) sits
   beside it as one more line. */
function WithGoogle({ token, clientId }: { token: string; clientId: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <Button variant="secondary" disabled={leaving}
      onClick={() => { setLeaving(true); continueWithGoogle(token, clientId); }}>
      {leaving ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}

/* ── Behind the code ──────────────────────────────────────────────────
   Each part is its own section, and a new feature adds ONE line here: its
   section asks its own door route and draws nothing when it has nothing
   (guestKit.ts, MODULE.md). */

function Behind(
  { token, view, onUnlockGone }:
  { token: string; view: GuestPageView; onUnlockGone: () => void },
) {
  return (
    <>
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck className="size-4 text-success shrink-0" />
        <StatusPill tone="success">Verified on this phone</StatusPill>
      </div>
      <DetailsSection token={token} hotel={view.hotel.name} onUnlockGone={onUnlockGone} />
      <IdPhotoSection token={token} hotel={view.hotel.name} onUnlockGone={onUnlockGone} />
      <BillSection token={token} onUnlockGone={onUnlockGone} />
      {/* Only what this hotel has switched on (D21-63). */}
      {view.offers.length > 0 && (
        <RequestsSection token={token} offers={view.offers} onUnlockGone={onUnlockGone} />
      )}
      <TableBookingSection token={token} onUnlockGone={onUnlockGone} />
      <MessageTheDesk token={token} onUnlockGone={onUnlockGone} />
      <RoomDining token={token} onUnlockGone={onUnlockGone} />
      {view.booking && (
        <WakeUpSection token={token} checkIn={view.booking.checkIn} checkOut={view.booking.checkOut}
          onUnlockGone={onUnlockGone} />
      )}
      <GallerySection token={token} hotel={view.hotel.name} onUnlockGone={onUnlockGone} />
    </>
  );
}

const ID_TYPES: { value: Details["idType"]; label: string }[] = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving licence" },
  { value: "voter", label: "Voter ID" },
  { value: "other", label: "Other" },
];
const idLabel = (type: string) => ID_TYPES.find((t) => t.value === type)?.label ?? type;

/* ── Their details: a SUBMISSION the desk confirms (D21-8, D21-19) ──── */
function DetailsSection(
  { token, hotel, onUnlockGone }:
  { token: string; hotel: string; onUnlockGone: () => void },
) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["guest-behind", token, "details"],
    queryFn: () => getDetails(token),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Partial<Details>>({});
  const set = (k: keyof Details) => (v: string) => setD((was) => ({ ...was, [k]: v }));
  /* D27-169: Indian, another country, or not said - and not said sends
     nothing, so a nationality already on the booking is never overwritten
     by a question the guest skipped. */
  const [nationality, setNationality] = useState<"" | "IN" | "other">("");
  const abroad = nationality === "other";

  const send = useMutation({
    mutationFn: () => sendDetails(token, detailsToSend(d, nationality)),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "details"] });
    },
  });
  useUnlockGone(state.error ?? send.error, onUnlockGone);

  const sent = state.data?.sent ?? null;
  const showForm = editing || !sent || sent.status === "set_aside";

  return (
    <section className={SECTION}>
      <h2 className={cn(H2, "mb-3")}>Your check-in details</h2>

      <Card><CardBody>
        {sent && !showForm && (
          <div className="text-sm text-grey-600">
            <p className="text-base text-ink-900">
              {idLabel(sent.idType)} ending {sent.idLastFour}
            </p>
            <p className="mt-1">
              {sent.status === "confirmed"
                ? "Checked by the desk. Nothing more is needed."
                : `Sent ${dateTime(sent.submittedAt)}. The desk will check them against your ID when you arrive.`}
            </p>
            {sent.status === "waiting" && (
              <Button variant="secondary" className="mt-3.5 w-full" onClick={() => setEditing(true)}>
                Change what I sent
              </Button>
            )}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
            className="flex flex-col gap-3"
          >
            {!sent && <Notice hotel={hotel} />}
            <p className="text-sm text-grey-600">
              The desk checks these against your ID when you arrive, so you do not
              have to wait while they are typed. You sign at the desk as usual.
            </p>
            <Field label="Your ID">
              {(f) => (
                <NativeSelect
                  {...fieldProps(f)} value={d.idType ?? ""}
                  onChange={(e) => set("idType")(e.target.value)}
                >
                  <option value="" disabled>Choose one</option>
                  {ID_TYPES.filter((t) => !state.data?.idTypesOff?.includes(t.value))
                    .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </NativeSelect>
              )}
            </Field>
            <TextField label="The number on it" value={d.idNumber} onChange={set("idNumber")} />
            <Field label="Your nationality">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={nationality}
                  onChange={(e) => setNationality(e.target.value as "" | "IN" | "other")}>
                  <option value="">Choose one</option>
                  <option value="IN">Indian</option>
                  <option value="other">Another country</option>
                </NativeSelect>
              )}
            </Field>
            {abroad && (
              <TextField label="Which country?" value={d.nationality} onChange={set("nationality")}
                maxLength={60} />
            )}
            {(d.idType === "passport" || abroad) && (
              <>
                <TextField label="Passport expires" type="date" value={d.passportExpiry} onChange={set("passportExpiry")} />
                <TextField label="Visa number" value={d.visaNumber} onChange={set("visaNumber")} />
                <TextField label="Visa expires" type="date" value={d.visaExpiry} onChange={set("visaExpiry")} />
              </>
            )}
            {/* Form III (147): what the portal asks of every foreign guest. */}
            {abroad && <FormIII d={d} set={set} setD={setD} />}
            <TextField label="Address" value={d.addressLine} onChange={set("addressLine")} autoComplete="street-address" />
            <TextField label="City" value={d.city} onChange={set("city")} autoComplete="address-level2" />
            <TextField label="Country" value={d.country} onChange={set("country")} autoComplete="country-name" />
            <TextField label="When do you expect to arrive?" type="time" value={d.expectedArrival}
              onChange={set("expectedArrival")} />
            <Field label="Anything you would like us to know?">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={3} maxLength={500}
                  value={d.specialRequests ?? ""} onChange={(e) => set("specialRequests")(e.target.value)} />
              )}
            </Field>
            {/* D25-39: offers only to a guest who said yes. Unticked, none. A
                plain box: the shared one measures itself inside a form. */}
            <label className="flex items-center gap-2.5 text-sm text-ink-900 pointer-coarse:min-h-11 cursor-pointer">
              <input
                type="checkbox" className="size-4 accent-brand-orange cursor-pointer"
                checked={d.offersAgreed === true}
                onChange={(e) => setD((was) => ({ ...was, offersAgreed: e.target.checked }))}
              />
              Send me offers from {hotel}
            </label>
            <Button
              type="submit" variant="primary"
              disabled={send.isPending || !d.idType || !(d.idNumber ?? "").trim()}
            >
              {send.isPending ? "Sending…" : "Send my details"}
            </Button>
            {/* Back to what was sent, unchanged (QA GP-4). */}
            {editing && (
              <Button type="button" variant="secondary" onClick={() => { setEditing(false); setD({}); }}>
                Cancel
              </Button>
            )}
            {send.error && !unlockGone(send.error) && (
              <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
            )}
          </form>
        )}
      </CardBody></Card>
    </section>
  );
}

/* ── A photo of their ID (D27-207 to D27-212) ────────────────────────
   Optional, and only once the details are sent: it is part of that
   submission, for the desk to check against the real ID. The notice and
   the tick come BEFORE the file button (`idPhotoNotice.ts`, approved by
   the owner), Aadhaar's rule among them.

   ⚠ THE GUEST SENDS AND NEVER READS BACK. The chosen photo is shown from
   this phone before it goes; afterwards the page knows only that one is
   there and since when, or that the desk removed it and why. Nothing of
   it is kept on this phone.

   Drawn only where the hotel takes them (its password is on the server)
   and only when there is something to say. */
function IdPhotoSection(
  { token, hotel, onUnlockGone }:
  { token: string; hotel: string; onUnlockGone: () => void },
) {
  const qc = useQueryClient();
  /* The details' own state (the same read as the section above): a photo
     may be added the moment they are sent, so this asks again when that
     changes. */
  const details = useQuery({
    queryKey: ["guest-behind", token, "details"],
    queryFn: () => getDetails(token),
    retry: false,
  });
  const state = useQuery({
    queryKey: ["guest-behind", token, "id-photo", details.data?.sent?.status ?? "none"],
    queryFn: () => getIdPhoto(token),
    retry: false,
  });

  const [chosen, setChosen] = useState<ChosenPhotos>({ front: null, back: null });
  const [agreed, setAgreed] = useState(false);
  const [again, setAgain] = useState(false);
  const send = useMutation({
    mutationFn: async () => sendIdPhoto(token, {
      front: await shrinkPhoto(chosen.front!),
      back: chosen.back ? await shrinkPhoto(chosen.back) : null,
    }),
    onSuccess: async () => {
      setChosen({ front: null, back: null });
      setAgreed(false);
      setAgain(false);
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "id-photo"] });
    },
  });
  useUnlockGone(state.error ?? send.error, onUnlockGone);

  const it = state.data;
  if (!it?.offered || (!it.maySend && !it.sent && !it.removed)) return null;
  const notice = idPhotoNotice(hotel, it.contact);
  const asking = it.maySend && (!it.sent || again);

  return (
    <section className={SECTION} data-id-photo>
      <h2 className={cn(H2, "mb-3")}>{notice.heading}</h2>
      <Card><CardBody>
        {it.sent && !asking && (
          <div className="text-sm text-grey-600">
            <p className="text-base text-ink-900">
              {it.sent.sides.includes("back") ? "Front and back sent" : "Photo sent"}
            </p>
            <p className="mt-1">
              {dateTime(it.sent.at)}. {it.maySend
                ? "The desk will check it against your ID when you arrive."
                : "The desk has checked your details. Nothing more is needed."}
            </p>
            {it.maySend && (
              <Button variant="secondary" className="mt-3.5 w-full" onClick={() => setAgain(true)}>
                Send a different photo
              </Button>
            )}
          </div>
        )}

        {/* The desk's reason, in the door's words. */}
        {it.removed && !it.sent && (
          <p className={cn("text-sm text-brand-red-700", asking && "mb-3")}>{it.removed}</p>
        )}

        {asking && (
          <form
            onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
            className="flex flex-col gap-3"
          >
            {/* THE NOTICE, before the first button. */}
            <dl className="rounded-lg bg-grey-100 px-3.5 py-3 text-sm flex flex-col gap-2" data-id-photo-notice>
              {notice.points.map((p) => (
                <div key={p.label}>
                  <dt className="font-medium text-ink-900">{p.label}</dt>
                  <dd className="text-grey-600">{p.text}</dd>
                </div>
              ))}
            </dl>
            <IdPhotoInputs value={chosen} onChange={setChosen} disabled={send.isPending} />
            <label className="flex items-start gap-2.5 text-sm text-ink-900 pointer-coarse:min-h-11 cursor-pointer">
              <input
                type="checkbox" className="mt-0.5 size-4 accent-brand-orange cursor-pointer"
                checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              />
              {notice.agree}
            </label>
            <Button type="submit" variant="secondary" disabled={send.isPending || !chosen.front || !agreed}>
              {send.isPending ? "Sending…" : "Send the photo"}
            </Button>
            {again && (
              <Button type="button" variant="ghost" onClick={() => { setAgain(false); setChosen({ front: null, back: null }); }}>
                Cancel
              </Button>
            )}
            <p className="text-sm text-grey-600">{notice.skip}</p>
            {send.error && !unlockGone(send.error) && (
              <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
            )}
          </form>
        )}
      </CardBody></Card>
    </section>
  );
}

/* ── The bill as it stands (D21-10) ─────────────────────────────────
   EXACTLY THE BILL THE DESK PRINTS: finance's own `BillPrint`, drawing
   finance's one definition of a bill (`app.stay_bill`, migration 123)
   through the door. Nothing here adds, taxes or rounds.

   Titled "Interim bill", not "Tax Invoice": this is a bill with no invoice
   number, before check-out, and a guest reading "Tax Invoice" would take it
   for the final one. Paying online is not in this version (the brief), so
   it says where to pay. */
function BillSection({ token, onUnlockGone }: { token: string; onUnlockGone: () => void }) {
  const bill = useQuery({
    queryKey: ["guest-behind", token, "bill"],
    queryFn: () => getBill(token),
    retry: false,
  });
  useUnlockGone(bill.error, onUnlockGone);

  return (
    <section className={SECTION}>
      <h2 className={H2}>Your bill so far</h2>
      {bill.isLoading && <p className={LEAD}>One moment…</p>}
      {bill.error && !unlockGone(bill.error) && (
        <p className={LEAD}>{messageFrom(bill.error)}</p>
      )}
      {bill.data && (
        <>
          <p className={cn(LEAD, "mb-3")}>Pay at the desk before you leave.</p>
          <BillPrint bill={bill.data} title="Interim bill" />
        </>
      )}
    </section>
  );
}

/* ── A spa or laundry request (D21-9) ────────────────────────────────
   A request the desk confirms, never a booking: the spa and laundry keep
   their own rules on their own screens. */
const KIND_LABEL: Record<string, string> = {
  spa: "Spa", laundry: "Laundry",
  /* While checked in, a request goes straight to its team (D27-181). */
  housekeeping: "Housekeeping", maintenance: "Something broken", fnb: "Food and drink",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Waiting for the desk", done: "Done", declined: "Declined",
  waiting: "Open", in_progress: "Being done",
};

function RequestsSection(
  { token, offers, onUnlockGone }:
  { token: string; offers: string[]; onUnlockGone: () => void },
) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["guest-behind", token, "requests"],
    queryFn: () => getRequests(token),
    retry: false,
  });
  const [kind, setKind] = useState(offers[0]!);
  const [what, setWhat] = useState("");
  const [wanted, setWanted] = useState("");
  /* While checked in, the tiles come first and the text box waits behind
     "Something else" (D27-224). */
  const quick = hasQuickChoices(offers);
  const [other, setOther] = useState(!quick);

  const ask = useMutation({
    mutationFn: () => makeRequest(token, { kind, what, wanted }),
    onSuccess: async () => {
      setWhat(""); setWanted("");
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "requests"] });
    },
  });
  useUnlockGone(list.error ?? ask.error, onUnlockGone);
  /* A message to the desk is not a request for the spa or laundry. */
  const mine = (list.data?.requests ?? []).filter((q) => q.kind !== "desk");

  return (
    <section className={SECTION}>
      <h2 className={cn(H2, "mb-3")}>Ask for something</h2>
      <Card><CardBody>
        {quick && <QuickChoices token={token} offers={offers} onOther={setOther} onUnlockGone={onUnlockGone} />}
        {other && <form onSubmit={(e) => { e.preventDefault(); ask.mutate(); }} className="flex flex-col gap-3">
          {offers.length > 1 && (
            /* One a line on a phone: with the teams' three (D27-181) they do
               not fit across. */
            <Segmented
              className="grid w-full sm:grid-cols-3"
              value={kind} onChange={setKind}
              options={offers.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
            />
          )}
          <Field label={offers.length > 1 ? "What would you like?" : `${KIND_LABEL[kind] ?? kind}: what would you like?`}>
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} maxLength={500}
                value={what} onChange={(e) => setWhat(e.target.value)} />
            )}
          </Field>
          <TextField label="When would suit you?" value={wanted} onChange={setWanted} maxLength={100} />
          <Button type="submit" variant="secondary" disabled={ask.isPending || what.trim() === ""}>
            {ask.isPending ? "Sending…" : "Send the request"}
          </Button>
          {ask.error && !unlockGone(ask.error) && (
            <p className="text-sm text-brand-red-700">{messageFrom(ask.error)}</p>
          )}
        </form>}

        {mine.length > 0 && (
          <ul className="mt-3.5 border-t border-grey-100 divide-y divide-grey-100 -mb-3.5">
            {mine.map((q) => (
              <li key={q.createdAt} className="py-3 text-sm">
                <p className="text-ink-900">{KIND_LABEL[q.kind] ?? q.kind}: {q.what}</p>
                <p className="text-grey-600 mt-0.5">
                  {q.wanted ? `${q.wanted} · ` : ""}{STATUS_LABEL[q.status] ?? q.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </section>
  );
}

/* ── Form III, for a foreign guest (D27-169, migration 147) ─────────────
   The person and the visit - the portal's own questions and lists. Not the
   remarks or where they go next: the desk asks those. The same words the
   desk's card shows (`LABELS`). */
const FORM_III_TEXT = ["passportIssuePlace", "passportIssueCountry", "visaType",
  "visaIssuePlace", "visaIssueCountry", "arrivedFrom", "previousStay", "arrivalPort",
  "mobileInIndia", "phoneInIndia", "mobileAbroad", "phoneAbroad",
  "refAddress", "refCity", "refState", "refPincode"] as const;
const FORM_III_DATES = ["dateOfBirth", "passportIssuedOn", "visaIssuedOn", "arrivedInIndiaOn"] as const;
const FORM_III = [...FORM_III_TEXT, ...FORM_III_DATES, "gender", "purpose", "purposeOther",
  "employedInIndia"] as const;

function FormIII(
  { d, set, setD }: {
    d: Partial<Details>; set: (k: keyof Details) => (v: string) => void;
    setD: (fn: (was: Partial<Details>) => Partial<Details>) => void;
  },
) {
  const pick = (k: "gender" | "purpose", options: { value: string; label: string }[]) => (
    <Field label={LABELS[k]!}>
      {(f) => (
        <NativeSelect {...fieldProps(f)} value={d[k] ?? ""} onChange={(e) => set(k)(e.target.value)}>
          <option value="">Choose one</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
      )}
    </Field>
  );
  const text = (k: (typeof FORM_III_TEXT)[number], type = "text") => (
    <TextField key={k} label={LABELS[k]!} type={type} value={d[k]} onChange={set(k)} />
  );
  const date = (k: (typeof FORM_III_DATES)[number]) => (
    <TextField key={k} label={LABELS[k]!} type="date" value={d[k]} onChange={set(k)} />
  );
  return (
    <>
      {pick("gender", GENDERS)}
      {date("dateOfBirth")}
      {date("passportIssuedOn")}
      {text("passportIssuePlace")}
      {text("passportIssueCountry")}
      {text("visaType")}
      {date("visaIssuedOn")}
      {text("visaIssuePlace")}
      {text("visaIssueCountry")}
      {text("arrivedFrom")}
      {text("previousStay")}
      {pick("purpose", PURPOSES)}
      {d.purpose === "others" && (
        <TextField label={LABELS["purposeOther"]!} value={d.purposeOther} onChange={set("purposeOther")} />
      )}
      {date("arrivedInIndiaOn")}
      {text("arrivalPort")}
      {text("mobileInIndia", "tel")}
      {text("phoneInIndia", "tel")}
      {text("mobileAbroad", "tel")}
      {text("phoneAbroad", "tel")}
      <Field label={LABELS["employedInIndia"]!}>
        {(f) => (
          <NativeSelect {...fieldProps(f)}
            value={d.employedInIndia === undefined ? "" : d.employedInIndia ? "yes" : "no"}
            onChange={(e) => setD((was) => ({
              ...was, employedInIndia: e.target.value === "" ? undefined : e.target.value === "yes",
            }))}>
            <option value="">Choose one</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        )}
      </Field>
      {text("refAddress")}
      {text("refCity")}
      {text("refState")}
      {text("refPincode")}
    </>
  );
}

/** What goes to the door: the nationality as chosen (nothing when not
    said), and Form III's answers only for a foreign guest - a guest who
    filled them in and then chose Indian sends none of them. */
function detailsToSend(d: Partial<Details>, nationality: "" | "IN" | "other"): Details {
  const out: Partial<Details> = { ...d };
  delete out.nationality;
  if (nationality === "IN") out.nationality = "IN";
  if (nationality === "other" && d.nationality?.trim()) out.nationality = d.nationality.trim();
  if (nationality !== "other") for (const k of FORM_III) delete out[k];
  return out as Details;
}

function TextField(
  { label, value, onChange, type = "text", autoComplete, maxLength }:
  {
    label: string; value: string | undefined; onChange: (v: string) => void;
    type?: string; autoComplete?: string; maxLength?: number;
  },
) {
  return (
    <Field label={label}>
      {(f) => (
        <Input {...fieldProps(f)} type={type} autoComplete={autoComplete} maxLength={maxLength}
          value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/* One narrow column, centred, no shell around it: the page's 20px sides,
   its parts in cards on the grey page. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-grey-50 px-5 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        {children}
      </div>
    </main>
  );
}

/** A state that is the whole page (loading, refused, unreachable): one card. */
function Note({ children }: { children: ReactNode }) {
  return <Card><CardBody>{children}</CardBody></Card>;
}
