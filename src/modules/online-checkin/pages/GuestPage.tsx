import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { dateLong } from "@/lib/format";
import { useDocumentTitle } from "@/lib/documentTitle";
import { Button, Field, fieldProps, Input, StatusPill } from "@/components/ui";
import {
  openGuestPage, sendCode, verifyCode, type GuestPageView,
} from "@/modules/online-checkin/data/guestPage";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PAGE — /g/:token

   THE ONE SCREEN IN THIS SYSTEM OPENED BY SOMEBODY THE HOTEL DOES NOT
   EMPLOY. It is outside the signed-in shell: no sidebar, no menu, no
   property picker, nothing that belongs to staff.

   What it may show before the six digits are answered is what a clerk
   would say across the counter — the guest's own name, their dates,
   and the last four digits of the number the booking carries. The
   bill, the check-in form and the requests are behind the code, and
   each one asks the SERVER again (guestDoor.ts): this screen deciding
   what to draw is not a guard.

   ⚠ A WRONG NUMBER AND A RIGHT ONE MUST LOOK THE SAME HERE TOO. The
   door answers both with one sentence; this prints that sentence and
   works out nothing of its own. Saying "that is not the number on the
   booking" is how a stranger finds the number by trying.

   375px is the primary size: this is read on a phone, usually one
   handed, often on hotel wifi.
   ══════════════════════════════════════════════════════════════════ */

/** The door's own sentence for everything it refuses, in its words. */
const NOTHING_HERE = "This link is not usable. Ask the desk for a new one.";

export default function GuestPage() {
  const token = useParams().token ?? "";

  const link = useQuery({
    queryKey: ["guest-page", token],
    queryFn: () => openGuestPage(token),
    retry: false,
  });

  useDocumentTitle(link.data ? link.data.hotel.name : "Your booking");

  if (link.isLoading) {
    return <Shell><p className="text-base text-grey-600">One moment…</p></Shell>;
  }

  /* Every failure reads the same, because a link that was revoked, one
     that expired and one that never existed must not be told apart. */
  if (link.error || !link.data) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink-900">{NOTHING_HERE}</h1>
      </Shell>
    );
  }

  return <Booking token={token} view={link.data} onVerified={() => void link.refetch()} />;
}

function Booking(
  { token, view, onVerified }:
  { token: string; view: GuestPageView; onVerified: () => void },
) {
  const { booking, hotel } = view;

  return (
    <Shell>
      <p className="text-sm text-grey-600">{hotel.name}</p>
      <h1 className="text-xl font-semibold text-ink-900 mt-0.5">{booking.guestName}</h1>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        <dt className="text-grey-600">Arriving</dt>
        <dd className="text-ink-900 tabular">{dateLong(booking.checkIn)}</dd>
        <dt className="text-grey-600">Leaving</dt>
        <dd className="text-ink-900 tabular">{dateLong(booking.checkOut)}</dd>
        <dt className="text-grey-600">Booking</dt>
        <dd className="text-ink-900 tabular">{booking.reference}</dd>
      </dl>

      {view.verified ? (
        <div className="mt-6 flex items-center gap-2">
          <ShieldCheck className="size-4 text-success shrink-0" />
          <StatusPill tone="success">Verified</StatusPill>
        </div>
      ) : (
        <ProveIt token={token} phoneHint={view.phoneHint} onVerified={onVerified} />
      )}
    </Shell>
  );
}

/* ── The six digits ───────────────────────────────────────────────
   Two steps on one screen: the number, then the code that arrives on
   it. The number is asked for even though the booking already carries
   one — the guest proves they hold the phone, and typing a number the
   booking does not have gets exactly this same screen back. */
function ProveIt(
  { token, phoneHint, onVerified }:
  { token: string; phoneHint: string | null; onVerified: () => void },
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
      <h2 className="text-base font-medium text-ink-900">
        Your bill and your check-in details are behind a code
      </h2>
      <p className="text-sm text-grey-600 mt-1">
        We send six digits on WhatsApp to the number this booking carries
        {phoneHint ? `, ending ${phoneHint}` : ""}.
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

      {/* The door's sentence, printed as it came. Its status says
          nothing either: a wrong number and a right one both land here. */}
      {asked.data && (
        <p className="text-sm text-grey-600 mt-3">{asked.data.message}</p>
      )}
      {asked.error && (
        <p className="text-sm text-grey-600 mt-3">
          {messageFrom(asked.error)}
        </p>
      )}

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

/** The server's own words where it gave some; nothing invented here.
    ⚠ `api()` lifts a body's `error` or `reason` into the message and
    NOT its `message` — and this door answers "codes cannot be sent
    yet" in `message` with a 503. So the guest was shown "Request
    failed (503)." where the door had written them a sentence saying
    what to do instead (OC-1, found by opening the screen). The body is
    read first here; the door's shape is not changed, because both
    halves of the send answer — the right number and a wrong one —
    carry the same field, and that sameness is the whole point. */
function messageFrom(error: unknown): string {
  const said = (error as { body?: { message?: string } } | null)?.body?.message;
  return said || (error instanceof Error && error.message) || NOTHING_HERE;
}

/* One narrow column, centred, no shell around it. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-grey-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-lg border border-grey-200 bg-white p-5">
        {children}
      </div>
    </main>
  );
}
