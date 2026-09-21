import { api } from "@/lib/api";
import type { StayBill } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PAGE — the calls the door answers

   The token in the address IS the credential (api/src/routes/
   guestDoor.ts, migrations 114 and 121). There is no session and no
   guest account.

   ⚠ THE UNLOCK (D21-6). Answering the six digits hands back a second
   secret that unlocks THIS phone, not the link. It is kept for the open
   tab only - sessionStorage, which dies with the tab and is never shared
   with another one - and sent as `Authorization: Guest …` on every call behind
   the code. A forwarded link carries none, so it is asked for a code
   again. Never in localStorage, never in a query key that is persisted,
   never in the address.

   `api()` adds no credential when nobody is signed in, and the door
   ignores one if a clerk happens to be signed in on the same browser.
   ══════════════════════════════════════════════════════════════════ */

export interface GuestPageView {
  /** A booking's own link, or a room's fixed card (D21-7). */
  kind: "booking" | "room";
  hotel: { code: string; name: string };
  /** The room card's own number; null on a booking's link. */
  room: string | null;
  /** A room card with nobody checked in says only that (D21-15). */
  occupied: boolean;
  /** Null on a room card until this phone has answered the code (D21-14). */
  booking: {
    reference: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
    status: string;
  } | null;
  /** Asked again on the SERVER for anything behind the code. */
  verified: boolean;
  /** The last four digits of the number the booking carries, or null. */
  phoneHint: string | null;
  /** Whether this server can send a code at all (D21-25). */
  canSendCodes: boolean;
  /** The door's own sentence when it cannot. */
  cannotSend: string | null;
  /** What the hotel offers behind the code (D21-63): "spa", "laundry". */
  offers: string[];
}

const KEY = (token: string) => `guest-unlock:${token.slice(0, 12)}`;

/** This tab's unlock for this link, if it has one. */
function heldUnlock(token: string): string | null {
  try { return sessionStorage.getItem(KEY(token)); } catch { return null; }
}

function keepUnlock(token: string, unlock: string): void {
  try { sessionStorage.setItem(KEY(token), unlock); } catch { /* a private tab: asked again */ }
}

/** Dropped when the door refuses it - expired, or a new guest in the room. */
export function dropUnlock(token: string): void {
  try { sessionStorage.removeItem(KEY(token)); } catch { /* nothing held */ }
}

const at = (token: string, rest = "") => `/api/guest/${encodeURIComponent(token)}${rest}`;

const withUnlock = (token: string, init: RequestInit = {}): RequestInit => {
  const unlock = heldUnlock(token);
  return unlock
    ? { ...init, headers: { ...(init.headers ?? {}), authorization: `Guest ${unlock}` } }
    : init;
};

export const openGuestPage = (token: string): Promise<GuestPageView> =>
  api<GuestPageView>(at(token), withUnlock(token));

/* ⚠ THE ANSWER IS THE SAME WHETHER OR NOT THE NUMBER WAS RIGHT — same
   words, same shape (guestDoor.ts). The screen prints the sentence the
   door sent and decides nothing from it. */
export interface CodeAnswer {
  sent: boolean;
  message?: string;
}

export const sendCode = (token: string, phone: string): Promise<CodeAnswer> =>
  api<CodeAnswer>(at(token, "/code"), {
    method: "POST",
    body: JSON.stringify({ phone }),
  });

export async function verifyCode(token: string, code: string): Promise<{ verified: boolean }> {
  const answer = await api<{ verified: boolean; unlock?: string }>(at(token, "/verify"), {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (answer.verified && answer.unlock) keepUnlock(token, answer.unlock);
  return { verified: answer.verified };
}

/* ── Behind the code ──────────────────────────────────────────────── */

/** Only the fields the owner named (D21-19). Nothing else is asked. */
export interface Details {
  idType: "aadhaar" | "passport" | "driving_licence" | "voter" | "other";
  idNumber: string;
  addressLine?: string;
  city?: string;
  country?: string;
  /** For a foreign guest. */
  passportExpiry?: string;
  visaNumber?: string;
  visaExpiry?: string;
}

export interface DetailsState {
  sent: {
    status: "waiting" | "confirmed" | "set_aside";
    submittedAt: string;
    idType: string;
    /** The last four digits only, on this screen as on every other (D21-18). */
    idLastFour: string;
  } | null;
}

export const getDetails = (token: string): Promise<DetailsState> =>
  api<DetailsState>(at(token, "/details"), withUnlock(token));

export const sendDetails = (token: string, details: Details): Promise<{ sent: true }> =>
  api<{ sent: true }>(at(token, "/details"), withUnlock(token, {
    method: "POST",
    body: JSON.stringify(details),
  }));

/** The bill as it stands (D21-10): finance's one definition (`app.stay_bill`,
    migration 123) for this stay, through the door. Nothing here adds a figure. */
export const getBill = (token: string): Promise<StayBill> =>
  api<StayBill>(at(token, "/bill"), withUnlock(token));

export interface GuestRequest {
  kind: "spa" | "laundry";
  what: string;
  wanted: string | null;
  status: "open" | "done" | "declined";
  createdAt: string;
}

export const getRequests = (token: string): Promise<{ offers: string[]; requests: GuestRequest[] }> =>
  api(at(token, "/requests"), withUnlock(token));

export const makeRequest = (
  token: string, request: { kind: string; what: string; wanted?: string },
): Promise<{ sent: true }> =>
  api<{ sent: true }>(at(token, "/requests"), withUnlock(token, {
    method: "POST",
    body: JSON.stringify(request),
  }));
