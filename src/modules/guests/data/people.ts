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
