import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, UserCheck } from "lucide-react";
import { Button, Switch } from "@/components/ui";
import { findReturningGuest } from "@/modules/guests/data/people";
import { phoneKey, emailKey } from "@/modules/guests/logic/contactKeys";

/* ══════════════════════════════════════════════════════════════════
   "STAYED WITH THE GROUP 3 TIMES - SAME PERSON?"

   The booking form and the walk-in both show this under the phone and
   email (D21-20). The clerk says yes - the booking is that guest's - or
   not them - a new guest, as it always was. NEVER AUTOMATIC (D21-2):
   nothing is chosen until the clerk presses a button, and the form clears
   the choice whenever the phone or email is typed again.

   The desk sees a name and a count, and nothing more (D21-13). "The
   group", not a name: nothing in the system holds the group's name, and
   nothing new may say Fidato (D21-27; the owner, 21 September).

   A BLACKLISTED match is a warning with its reason, on ANY match, and it
   never stops the booking - a person decides (D21-21).
   ══════════════════════════════════════════════════════════════════ */

/** "Stayed with the group 3 times" - checked-in visits, a group of rooms once. */
export function stayedWords(visits: number): string {
  if (visits <= 0) return "Has not stayed with the group yet";
  if (visits === 1) return "Stayed with the group once";
  return `Stayed with the group ${visits} times`;
}

/** Asked only once there is a number or an address worth asking about, so a
    half-typed phone is not a request per keystroke. */
const worthAsking = (phone: string, email: string) =>
  phoneKey(phone) !== null || /.+@.+\..+/.test(email.trim());

export function ReturningGuest({
  hotelId, phone, email, chosen, onChoose,
}: {
  hotelId: string;
  phone: string;
  email: string;
  /** The guest the clerk confirmed, or null. */
  chosen: { id: string; name: string } | null;
  onChoose: (guest: { id: string; name: string } | null) => void;
}) {
  const ask = worthAsking(phone, email);
  const found = useQuery({
    queryKey: ["returning-guest", hotelId, phoneKey(phone), emailKey(email)],
    queryFn: () => findReturningGuest(hotelId, phone.trim(), email.trim()),
    enabled: ask && !!hotelId,
  });
  const matches = ask ? (found.data ?? []) : [];
  const warnings = matches.filter((m) => m.blacklisted);
  const suggestions = matches.filter((m) => m.suggested && m.guestId);

  if (matches.length === 0) return null;

  return (
    <div className="space-y-2" data-returning-guest>
      {warnings.map((m) => (
        <div key={`w-${m.guestId ?? m.name}`} role="alert"
          className="flex items-start gap-2 rounded-md border border-brand-red-100 bg-red-50 p-3 text-sm text-brand-red">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-medium">{m.name} is blacklisted.</span>{" "}
            Reason: {m.blacklistReason ?? "-"}. The booking is not refused - you decide.
          </span>
        </div>
      ))}

      {suggestions.map((m) => {
        const isChosen = chosen?.id === m.guestId;
        return (
          <div key={m.guestId}
            className="flex flex-wrap items-center gap-3 rounded-md border border-grey-200 bg-grey-50 p-3">
            <UserCheck className="size-4 shrink-0 text-grey-500" />
            <span className="min-w-0 flex-1 text-sm text-ink-900">
              <span className="font-medium">{m.name}</span>
              {" · "}{stayedWords(m.visits ?? 0)}
              {isChosen ? " - this booking is theirs." : " - same person?"}
            </span>
            {isChosen ? (
              <Button variant="secondary" onClick={() => onChoose(null)}>
                Not them
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => onChoose({ id: m.guestId!, name: m.name })}>
                Same person
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── The two ticks the desk asks about ─────────────────────────────
   "Guest agreed to WhatsApp" (D21-72): WhatsApp's own rule is that a
   business may start a conversation only with somebody who agreed, so a
   booking nobody ticked gets email if it has one, else nothing.
   "Do not send offers" (D21-22): kept against the phone and email
   themselves, for the whole group - a manager may clear it on Guest 360. */
export function ConsentTicks({
  whatsapp, onWhatsapp, noOffers, onNoOffers,
}: {
  whatsapp: boolean;
  onWhatsapp: (v: boolean) => void;
  noOffers: boolean;
  onNoOffers: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <Switch
        checked={whatsapp}
        onCheckedChange={onWhatsapp}
        label="Guest agreed to WhatsApp"
        description="Ask them. Unticked, messages go by email if there is one, else not at all."
      />
      <Switch
        checked={noOffers}
        onCheckedChange={onNoOffers}
        label="Do not send offers"
        description="Kept against this phone and email at every hotel of the group."
      />
    </div>
  );
}
