import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api";
import { dateLong, dateShort, dateTime } from "@/lib/format";
import {
  Button, Field, fieldProps, Input, NativeSelect, Segmented, StatusPill, Textarea,
} from "@/components/ui";
import {
  dropUnlock, getBill, getDetails, getRequests, makeRequest, openGuestPage, sendCode,
  sendDetails, verifyCode, type Details, type GuestPageView,
} from "@/modules/online-checkin/data/guestPage";
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

/** Refused behind the code: the unlock has gone - expired, or a new guest
    is in the room. Not an error to show: the page asks for a code again. */
const unlockGone = (error: unknown) => error instanceof ApiError && error.status === 404;

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
    return <Shell><p className="text-base text-grey-600">One moment…</p></Shell>;
  }

  /* ⚠ A LINE THAT IS DOWN IS NOT A DEAD LINK (OCI-3, found by opening the
     page while its server was starting). It said "Ask the desk for a new
     one" to a guest on hotel wifi whose link was fine. Nothing reached the
     door, so saying so tells a stranger nothing about the link. */
  if (link.error instanceof ApiError && link.error.status === 0) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink-900">We could not reach the hotel</h1>
        <p className="text-base text-grey-600 mt-2">Check your connection, then try again.</p>
        <Button variant="primary" className="mt-4" onClick={() => void link.refetch()}>
          Try again
        </Button>
      </Shell>
    );
  }

  /* Every refusal reads the same, because a link that was revoked, one
     that expired and one that never existed must not be told apart. */
  if (link.error || !link.data) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink-900">{NOTHING_HERE}</h1>
      </Shell>
    );
  }

  const view = link.data;

  /* D21-15, in the owner's words, with the hotel's name and nothing else. */
  if (view.kind === "room" && !view.occupied) {
    return (
      <Shell>
        <p className="text-sm text-grey-600">{view.hotel.name}</p>
        <h1 className="text-xl font-semibold text-ink-900 mt-0.5">
          This opens once you're checked in
        </h1>
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
        <p className="mt-6 border-t border-grey-200 pt-5 text-base text-grey-600">
          {view.cannotSend ?? NOTHING_HERE}
        </p>
      )}
    </Shell>
  );
}

function Heading({ view }: { view: GuestPageView }) {
  const { booking } = view;
  return (
    <>
      <p className="text-sm text-grey-600">{view.hotel.name}</p>
      <h1 className="text-xl font-semibold text-ink-900 mt-0.5">
        {booking ? booking.guestName : `Room ${view.room}`}
      </h1>
      {booking && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-grey-600">Arriving</dt>
          <dd className="text-ink-900 tabular">{dateLong(booking.checkIn)}</dd>
          <dt className="text-grey-600">Leaving</dt>
          <dd className="text-ink-900 tabular">{dateLong(booking.checkOut)}</dd>
          <dt className="text-grey-600">Booking</dt>
          <dd className="text-ink-900 tabular">{booking.reference}</dd>
        </dl>
      )}
    </>
  );
}

/* ── The privacy notice, BEFORE THE FIRST QUESTION (D21-61) ──────────
   A place for the advisor's words; empty until they are approved
   (`privacyNotice.ts`). */
function Notice({ hotel }: { hotel: string }) {
  const notice = privacyNoticeFor(hotel);
  if (!notice) return null;
  return (
    <section data-privacy-notice className="mb-5 rounded-md border border-grey-200 bg-grey-50 p-3.5">
      <h2 className="text-base font-medium text-ink-900">{notice.heading}</h2>
      <p className="text-sm text-grey-600 mt-1 whitespace-pre-line">{notice.body}</p>
    </section>
  );
}

/* ── The six digits ───────────────────────────────────────────────
   The number is asked for even though the booking already carries one:
   the guest proves they hold the phone, and a number the booking does not
   have gets exactly this same screen back. On a room card there is no
   hint - whoever holds the card is standing in somebody's room. */
function ProveIt(
  { token, view, onVerified }:
  { token: string; view: GuestPageView; onVerified: () => void },
) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const asked = useMutation({ mutationFn: () => sendCode(token, phone) });
  const answered = useMutation({
    mutationFn: () => verifyCode(token, code),
    onSuccess: (r) => { if (r.verified) onVerified(); },
  });

  const ask = (e: FormEvent) => { e.preventDefault(); asked.mutate(); };
  const answer = (e: FormEvent) => { e.preventDefault(); answered.mutate(); };

  return (
    <section className="mt-6 border-t border-grey-200 pt-5">
      <Notice hotel={view.hotel.name} />
      <h2 className="text-base font-medium text-ink-900">
        Your check-in details are behind a code
      </h2>
      <p className="text-sm text-grey-600 mt-1">
        We send six digits on WhatsApp to the number the booking carries
        {view.phoneHint ? `, ending ${view.phoneHint}` : ""}.
      </p>

      <form onSubmit={ask} className="mt-4 flex flex-col gap-3">
        <Field label="Your phone number">
          {(f) => (
            <Input
              {...fieldProps(f)}
              type="tel" inputMode="tel" autoComplete="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="As it was given to the hotel"
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={asked.isPending || phone.trim() === ""}>
          {asked.isPending ? "Sending…" : "Send me the code"}
        </Button>
      </form>

      {/* The door's sentence, printed as it came - one shape for a right
          number, a wrong one and one knock too many (D21-25). */}
      {asked.data && <p className="text-sm text-grey-600 mt-3">{asked.data.message}</p>}
      {asked.error && <p className="text-sm text-grey-600 mt-3">{messageFrom(asked.error)}</p>}

      <form onSubmit={answer} className="mt-5 flex flex-col gap-3">
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
        <Button type="submit" variant="secondary" disabled={answered.isPending || code.trim() === ""}>
          {answered.isPending ? "Checking…" : "Open my booking"}
        </Button>
      </form>

      {answered.error && (
        <p className="text-sm text-brand-red mt-3">{messageFrom(answered.error)}</p>
      )}
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
      <div className="mt-5 flex items-center gap-2">
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
    <section className="mt-6 border-t border-grey-200 pt-5">
      <h2 className="text-base font-medium text-ink-900">Message the front desk</h2>
      <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="mt-3 flex flex-col gap-3">
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
          <p className="text-sm text-brand-red">{messageFrom(send.error)}</p>
        )}
      </form>

      {sent.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {sent.map((q) => (
            <li key={q.createdAt} className="rounded-md border border-grey-200 p-3 text-sm">
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

  const send = useMutation({
    mutationFn: () => sendDetails(token, d as Details),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "details"] });
    },
  });
  useUnlockGone(state.error ?? send.error, onUnlockGone);

  const sent = state.data?.sent ?? null;
  const showForm = editing || !sent || sent.status === "set_aside";

  return (
    <section className="mt-6 border-t border-grey-200 pt-5">
      <h2 className="text-base font-medium text-ink-900">Your check-in details</h2>

      {sent && !showForm && (
        <div className="mt-2 text-sm text-grey-600">
          <p className="text-base text-ink-900">
            {idLabel(sent.idType)} ending {sent.idLastFour}
          </p>
          <p className="mt-1">
            {sent.status === "confirmed"
              ? "Checked by the desk. Nothing more is needed."
              : `Sent ${dateTime(sent.submittedAt)}. The desk will check them against your ID when you arrive.`}
          </p>
          {sent.status === "waiting" && (
            <Button variant="secondary" className="mt-3" onClick={() => setEditing(true)}>
              Change what I sent
            </Button>
          )}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
          className="mt-3 flex flex-col gap-3"
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
          {d.idType === "passport" && (
            <>
              <TextField label="Passport expires" type="date" value={d.passportExpiry} onChange={set("passportExpiry")} />
              <TextField label="Visa number" value={d.visaNumber} onChange={set("visaNumber")} />
              <TextField label="Visa expires" type="date" value={d.visaExpiry} onChange={set("visaExpiry")} />
            </>
          )}
          <TextField label="Address" value={d.addressLine} onChange={set("addressLine")} autoComplete="street-address" />
          <TextField label="City" value={d.city} onChange={set("city")} autoComplete="address-level2" />
          <TextField label="Country" value={d.country} onChange={set("country")} autoComplete="country-name" />
          <Button
            type="submit" variant="primary"
            disabled={send.isPending || !d.idType || !(d.idNumber ?? "").trim()}
          >
            {send.isPending ? "Sending…" : "Send my details"}
          </Button>
          {send.error && !unlockGone(send.error) && (
            <p className="text-sm text-brand-red">{messageFrom(send.error)}</p>
          )}
        </form>
      )}
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
    <section className="mt-6 border-t border-grey-200 pt-5">
      <h2 className="text-base font-medium text-ink-900">Your bill so far</h2>
      {bill.isLoading && <p className="text-sm text-grey-600 mt-2">One moment…</p>}
      {bill.error && !unlockGone(bill.error) && (
        <p className="text-sm text-grey-600 mt-2">{messageFrom(bill.error)}</p>
      )}
      {bill.data && (
        <>
          <p className="text-sm text-grey-600 mt-1 mb-3">Pay at the desk before you leave.</p>
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
    <section className="mt-6 border-t border-grey-200 pt-5">
      <h2 className="text-base font-medium text-ink-900">Ask for something</h2>
      <form onSubmit={(e) => { e.preventDefault(); ask.mutate(); }} className="mt-3 flex flex-col gap-3">
        {offers.length > 1 && (
          <Segmented
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
          <p className="text-sm text-brand-red">{messageFrom(ask.error)}</p>
        )}
      </form>

      {mine.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {mine.map((q) => (
            <li key={q.createdAt} className="rounded-md border border-grey-200 p-3 text-sm">
              <p className="text-ink-900">{KIND_LABEL[q.kind] ?? q.kind}: {q.what}</p>
              <p className="text-grey-600 mt-0.5">
                {q.wanted ? `${q.wanted} · ` : ""}{STATUS_LABEL[q.status] ?? q.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

/* One narrow column, centred, no shell around it. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-grey-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-lg border border-grey-200 bg-white p-5">
        {children}
      </div>
    </main>
  );
}
