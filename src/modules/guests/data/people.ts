import { fetchOr } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   WHO IS THIS? — the returning-guest suggestion (D21-20)

   Asked as a clerk types a phone or an email on the booking form or the
   walk-in. The server makes every match (api/src/modules/guests/people.ts,
   over the database's own rule) and answers only what the desk may see:
   a name and how many times they stayed with the group - no hotels, no
   dates, no amounts (D21-13) - and a blacklist warning with its reason
   (D21-21). Nothing is joined for the clerk; they choose.
   ══════════════════════════════════════════════════════════════════ */

export interface ReturningMatch {
  /** Only on a suggestion - the id a booking may use. The server checks
      it again when the booking arrives. */
  guestId?: string;
  /** Checked-in visits at any hotel of the group; a suggestion only. */
  visits?: number;
  name: string;
  /** False when what was typed disagrees with what is on file: then it
      is here only to carry a blacklist warning, never to be chosen. */
  suggested: boolean;
  blacklisted: boolean;
  blacklistReason: string | null;
}

export async function findReturningGuest(
  hotelId: string, phone: string, email: string,
): Promise<ReturningMatch[]> {
  if (!hotelId) return [];
  const query = new URLSearchParams({ phone, email });
  const out = await fetchOr<{ matches: ReturningMatch[] }>(
    `/api/hotels/${hotelId}/guests/returning?${query}`, { matches: [] });
  return out.matches;
}

/* ══════════════════════════════════════════════════════════════════
   A BOOKING SITE'S GUEST WHO IS A BLACKLISTED GUEST (CRM-3, D22-8)

   A booking the channel manager makes has no clerk to see the warning
   above. Arrivals and the check-in ask the server instead: which bookings
   from a booking site, arriving between these dates, have a guest whose
   phone or email is a blacklisted guest's (the same exact match). A
   warning only - nothing is joined and nothing refused (D21-2, D21-21).
   ══════════════════════════════════════════════════════════════════ */

export interface BlacklistWarning {
  stayId: string;
  reference: string;
  /** The name the booking site sent. */
  guest: string;
  /** The booking site: Booking.com, Agoda... */
  source: string;
  blacklistedName: string;
  reason: string | null;
}

export async function listBlacklistWarnings(
  hotelId: string, from: string, to: string,
): Promise<BlacklistWarning[]> {
  if (!hotelId) return [];
  const query = new URLSearchParams({ from, to });
  const out = await fetchOr<{ warnings?: BlacklistWarning[] }>(
    `/api/hotels/${hotelId}/guests/blacklist-warnings?${query}`, { warnings: [] });
  return out.warnings ?? [];
}
