import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   GUEST MESSAGES — the seam

   What this system sent a guest, and whether it arrived. One row per
   attempt, kept by migration 117 and written by the sender itself
   (api/src/sending.ts) — the one door out of this system. Nothing here
   writes anything: this service reads that record and never adds to it.

   `connected` IS THE WHOLE POINT OF THE SCREEN. An empty list means two
   completely different things - nothing has been sent, or nothing CAN
   be - and only the server knows which, because the webhook address and
   the secret live in its settings and nowhere else.
   ══════════════════════════════════════════════════════════════════ */

export interface SentMessage {
  id: string;
  /** whatsapp | email. The PMS decides per message; n8n branches on it. */
  channel: string;
  /** The word the sender filed it under. A kind is a word and not an
      enum (migration 117), so this is not a closed set. */
  kind: string;
  /** The same thing in the desk's words. An unnamed kind shows as itself. */
  kindLabel: string;
  /** WHO IT WENT TO, AS IT WAS AT THE TIME. A guest changes their number
      and the record of where the message actually went does not change
      with them. */
  to: { name: string | null; phone: string | null; email: string | null };
  /** The booking, the bill or the order it was about. `reference` is
      filled only where it was a booking. */
  about: { kind: string; id: string; reference: string | null } | null;
  /** The document that went with it (D18-20), where one did. */
  document: { name: string; bytes: number | null } | null;
  /** The property's own clock, not the server's (migration 113). */
  sentAt: string;
  /** sent | failed. There is no third state: a message the PMS never
      handed over is not an attempt and has no row. */
  status: string;
  /** What the receiver said, or why it could not be reached. Shown to a
      clerk, never parsed. */
  detail: string | null;
  /** Their name - or null, which means EITHER nobody sent it OR this
      reader may not see who did (`staff` is row-secured). `byAPerson`
      is the half that says which. */
  sentBy: string | null;
  /** Whether a person pressed something at all. The two messages this
      system sends by itself have nobody behind them (D18-11, D18-12). */
  byAPerson: boolean;
}

export interface GuestMessages {
  /** Whether anything can be sent at all. False until the owner finishes
      their n8n steps (docs/briefs/n8n-sending.md). */
  connected: boolean;
  /** The sender's own sentence for why, where it cannot. One wording, so
      the desk reads the same thing wherever it meets this. */
  notConnected: string | null;
  /** Whether this hotel has online check-in on (D27-266): off, the desk's
      Send check-in link is hidden. */
  onlineCheckIn: boolean;
  messages: SentMessage[];
  /** Future bookings no message can reach (MSG-3): no email, and no
      number the guest agreed to WhatsApp on (D21-72). Nothing is recorded
      where nothing was attempted, so without this list the desk would
      never learn it. The server reads it from the sweep's own answer. */
  unreachable: Unreachable[];
}

export interface Unreachable {
  id: string;
  reference: string;
  guest: string;
  /** YYYY-MM-DD, the property's own day. */
  checkIn: string;
  /** Why, in the desk's words: what to add to the booking. */
  why: string;
}

/** The booking's own page, sent to the guest now (D27-105). The ONE write
    this seam makes - and it writes nothing itself: the server sends through
    the one door out, which records the attempt. Refused (an error with the
    server's sentence) for a booking waiting for the hotel, not confirmed,
    or with nowhere to send it. */
export const sendCheckInLink = (hotelCode: string, reservationId: string) =>
  api<{ ok: true }>(
    `/api/hotels/${hotelCode}/stays/${encodeURIComponent(reservationId)}/checkin-link`,
    { method: "POST", body: "{}" });

/** Everything sent at one property, newest first - or, given a booking,
    only what went about that one. */
export async function getGuestMessages(
  hotelCode: string, reservationId?: string,
): Promise<GuestMessages> {
  const forOne = reservationId ? `?reservation=${encodeURIComponent(reservationId)}` : "";
  return api<GuestMessages>(`/api/hotels/${hotelCode}/guest-messages${forOne}`);
}
