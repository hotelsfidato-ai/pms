import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateLong, dateShort, dateTime } from "@/lib/format";
import {
  Button, Card, CardBody, Field, fieldProps, Input, NativeSelect, Segmented, StatusPill, Textarea,
} from "@/components/ui";
import {
  codeAskedRecently, dropUnlock, getBill, getDetails, getRequests, makeRequest, openGuestPage,
  sendCode, sendDetails, verifyCode, type Details, type GuestPageView,
} from "@/modules/online-checkin/data/guestPage";
import { GENDERS, LABELS, PURPOSES } from "@/modules/online-checkin/formIII";
import { privacyNoticeFor } from "@/modules/online-checkin/privacyNotice";
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

/** The door's own sentence for everything it refuses, in its words. */
const NOTHING_HERE = "This link is not usable. Ask the desk for a new one.";
/** The door's words for a booking with no mobile number (guestDoor.ts,
    NO_PHONE) - said here without asking, because the link already shows
    there is no number to send to. Change one, change both. */
const NO_PHONE = "There is no mobile number on this booking, so no code can be "
  + "sent. Ask the desk.";

/** Refused behind the code: the unlock has gone - expired, or a new guest
    is in the room. Not an error to show: the page asks for a code again. */
const unlockGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/* The fidato look, phone first (375px is this page's primary size): the
   guest's name as the large title, then one card per part, each under its
   own 16px heading, parts 20px apart and 12px from a heading to its card.
   The bill is finance's own document, so it sits on the page, not in a
   card of ours. */
const SECTION = "mb-5 last:mb-0";
const H2 = "text-md font-semibold text-ink-900";
const LEAD = "text-sm text-grey-600 mt-0.5";

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
      <Heading view={view} />
      {view.verified ? (
        <Behind token={token} view={view} onUnlockGone={askAgain} />
      ) : view.canSendCodes ? (
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

function Heading({ view }: { view: GuestPageView }) {
  const { booking } = view;
  return (
    <>
      {/* The large title: the hotel over the guest's name (or the room). */}
      <header className={booking ? "mb-3" : "mb-5"}>
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

/* ── The six digits (D27-105) ─────────────────────────────────────
   Nothing is typed but the code. Opening the link sends it to the number
   the booking carries - once; reopening within its ten minutes does not
   send another - and the door says where: the last four digits, or on a
   room card nothing of the number (D21-14). No number on the booking:
   the door's own "Ask the desk". */
function ProveIt(
  { token, view, onVerified }:
  { token: string; view: GuestPageView; onVerified: () => void },
) {
  const [code, setCode] = useState("");

  const asked = useMutation({ mutationFn: () => sendCode(token) });
  const answered = useMutation({
    mutationFn: () => verifyCode(token, code),
    onSuccess: (r) => { if (r.verified) onVerified(); },
  });

  /* A booking's link with no number on the booking: nothing to send, no
     code to wait for, no box to type one into - and nothing is asked of the
     door. (The door says the same words for a room card whose guest has no
     number: a room card never shows the number, so it asks.) */
  const noPhone = view.kind === "booking" && !view.phoneHint;

  /* Asked for by opening the page. `sendCode` notes the moment before it
     asks, so a second mount (a reload, React's own double run in
     development) finds it asked and sends nothing. */
  const { mutate: ask } = asked;
  useEffect(() => { if (!noPhone && !codeAskedRecently(token)) ask(); }, [noPhone, token, ask]);

  const answer = (e: FormEvent) => { e.preventDefault(); answered.mutate(); };

  return (
    <section className={SECTION}>
      <Notice hotel={view.hotel.name} className="mb-5" />
      <h2 className={H2}>
        Your check-in details are behind a code
      </h2>
      {noPhone ? <div className="mb-3" /> : (
        <p className={cn(LEAD, "mb-3")}>
          We send six digits on WhatsApp to the number on the booking
          {view.phoneHint ? `, ending ${view.phoneHint.replace("…", "")}` : ""}.
        </p>
      )}

      <Card><CardBody>
        {/* The door's sentence, printed as it came. */}
        <p className="text-sm text-grey-600" aria-live="polite">
          {noPhone ? NO_PHONE
            : asked.isPending ? "Sending the code…"
            : asked.data ? asked.data.message
            : asked.error ? messageFrom(asked.error)
            : "A code was sent a few minutes ago. Use it, or send a new one."}
        </p>
        {/* DEVELOPMENT ONLY (D27-105): the code on screen, from a server
            started to show it. A production build compiles this away, and
            scripts/check-no-dev-login.mjs fails any build that carries it. */}
        {import.meta.env.DEV && asked.data?.devCode && (
          <p className="text-sm text-warning-dark mt-1.5">
            Development only - the code is <span className="font-semibold tabular">{asked.data.devCode}</span>
          </p>
        )}

        {!noPhone && <form onSubmit={answer} className="mt-3.5 pt-3.5 border-t border-grey-100 flex flex-col gap-3">
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
          <Button type="button" variant="ghost" disabled={asked.isPending} onClick={() => ask()}>
            Send a new code
          </Button>
        </form>}

        {answered.error && (
          <p className="text-sm text-brand-red-700 mt-3">{messageFrom(answered.error)}</p>
        )}
      </CardBody></Card>
    </section>
  );
}

/* ── Behind the code ──────────────────────────────────────────────── */

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
      <BillSection token={token} onUnlockGone={onUnlockGone} />
      {/* Only what this hotel has switched on (D21-63). */}
      {view.offers.length > 0 && (
        <RequestsSection token={token} offers={view.offers} onUnlockGone={onUnlockGone} />
      )}
      <MessageTheDesk token={token} onUnlockGone={onUnlockGone} />
    </>
  );
}

/* ── Message the front desk (D23-14) ─────────────────────────────────
   Anything, in the guest's own words. A request of kind 'desk' through the
   same door and the same limits as a spa or laundry request; it lands in
   the booking's Guest messages at the desk, unread until handled.

   Under it, what they sent (the owner, 24 September): each Sent or
   Handled, with the day and nothing else - no staff name, no time. The
   door's own list of this stay's requests, the same read as above; the
   words are a text node, never HTML. */
function MessageTheDesk({ token, onUnlockGone }: { token: string; onUnlockGone: () => void }) {
  const qc = useQueryClient();
  const [what, setWhat] = useState("");
  const list = useQuery({
    queryKey: ["guest-behind", token, "requests"],
    queryFn: () => getRequests(token),
    retry: false,
  });
  const send = useMutation({
    mutationFn: () => makeRequest(token, { kind: "desk", what }),
    onSuccess: async () => {
      setWhat("");
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "requests"] });
    },
  });
  useUnlockGone(list.error ?? send.error, onUnlockGone);
  const sent = (list.data?.requests ?? []).filter((q) => q.kind === "desk");

  return (
    <section className={SECTION}>
      <h2 className={cn(H2, "mb-3")}>Message the front desk</h2>
      <Card><CardBody>
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="flex flex-col gap-3">
          <Field label="Your message">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} maxLength={500}
                value={what} onChange={(e) => setWhat(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={send.isPending || what.trim() === ""}>
            {send.isPending ? "Sending…" : "Send to the front desk"}
          </Button>
          {send.isSuccess && what === "" && (
            <p className="text-sm text-grey-600">Sent. The front desk will see it.</p>
          )}
          {send.error && !unlockGone(send.error) && (
            <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
          )}
        </form>

        {/* What they sent: list rows under a hairline, not boxes in the card. */}
        {sent.length > 0 && (
          <ul className="mt-3.5 border-t border-grey-100 divide-y divide-grey-100 -mb-3.5">
            {sent.map((q) => (
              <li key={q.createdAt} className="py-3 text-sm">
                <p className="text-ink-900 whitespace-pre-line break-words">{q.what}</p>
                <p className="mt-1 flex items-center gap-2 text-grey-600">
                  {dateShort(q.createdAt)}
                  <StatusPill tone={q.status === "open" ? "neutral" : "success"}>
                    {q.status === "open" ? "Sent" : "Handled"}
                  </StatusPill>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </section>
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

/** Refused behind the code → ask for a code again, once. */
function useUnlockGone(error: unknown, onUnlockGone: () => void) {
  useEffect(() => { if (unlockGone(error)) onUnlockGone(); }, [error, onUnlockGone]);
}

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
                  {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
const KIND_LABEL: Record<string, string> = { spa: "Spa", laundry: "Laundry" };
const STATUS_LABEL: Record<string, string> = {
  open: "Waiting for the desk", done: "Done", declined: "Declined",
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
        <form onSubmit={(e) => { e.preventDefault(); ask.mutate(); }} className="flex flex-col gap-3">
          {offers.length > 1 && (
            <Segmented
              className="flex w-full [&>button]:flex-1"
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
        </form>

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

/** The server's own words (`api()` reads `error`, `reason`, then
    `message` - fixed for every screen on 21 September); nothing invented. */
function messageFrom(error: unknown): string {
  return (error instanceof Error && error.message) || NOTHING_HERE;
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
