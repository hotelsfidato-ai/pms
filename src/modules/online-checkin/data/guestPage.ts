import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PAGE — the three calls the door answers

   The token in the address IS the whole credential (api/src/routes/
   guestDoor.ts, migration 114). It is passed on every call and never
   kept anywhere: no store, no localStorage, no query key that outlives
   the page. There is no session here and no guest account — losing the
   link is the only way out, which is the point of it.

   `api()` adds no credential when nobody is signed in, and the door
   ignores one if a clerk happens to be signed in on the same browser.
   ══════════════════════════════════════════════════════════════════ */

export interface GuestPageView {
  hotel: { code: string; name: string };
  booking: {
    reference: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
    status: string;
  };
  /** Asked again on the SERVER for anything behind the code. */
  verified: boolean;
  /** The last four digits of the number the booking carries, or null. */
  phoneHint: string | null;
}

export const openGuestPage = (token: string): Promise<GuestPageView> =>
  api<GuestPageView>(`/api/guest/${encodeURIComponent(token)}`);

/* ⚠ THE ANSWER IS THE SAME WHETHER OR NOT THE NUMBER WAS RIGHT — same
   words, same shape (guestDoor.ts). So this returns the sentence the
   door sent and the screen prints it, rather than deciding anything
   from it. A screen that said "that is not the number on the booking"
   would let a stranger find the number by trying. */
export interface CodeAnswer {
  sent: boolean;
  message?: string;
}

export const sendCode = (token: string, phone: string): Promise<CodeAnswer> =>
  api<CodeAnswer>(`/api/guest/${encodeURIComponent(token)}/code`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });

export const verifyCode = (token: string, code: string): Promise<{ verified: boolean }> =>
  api<{ verified: boolean }>(`/api/guest/${encodeURIComponent(token)}/verify`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
