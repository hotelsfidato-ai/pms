import { api, apiBase } from "@/lib/api";
import { upload } from "@/modules/online-checkin/data/upload";
import type { StayBill } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PAGE — the calls the door answers

   The token in the address IS the credential (api/src/routes/
   guestDoor.ts, migrations 114 and 121). There is no session and no
   guest account.

   ⚠ THE UNLOCK (D21-6). Answering the six digits hands back a second
   secret that unlocks THIS phone, not the link, and it is sent as
   `Authorization: Guest …` on every call behind the code. A forwarded link
   carries none, so it is asked for a code again.

   KEPT FOR A DAY, ON THIS PHONE (D27-169, replacing D21-92's hour in one
   tab): a guest who closes the tab and comes back from WhatsApp the same
   day is not asked for another code. So it lives in localStorage, keyed by
   the link - and the SERVER decides when it ends (a day, migration 162):
   the moment the door refuses it, it is dropped here. Never in a query key
   that is persisted, never in the address.

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
  /** The email the booking carries, masked ("a…@example.com"), or null:
      none on the booking, or a room card, which shows nothing of the guest. */
  emailHint: string | null;
  /** Whether this server can send a code at all (D21-25). */
  canSendCodes: boolean;
  /** The door's own sentence when it cannot. */
  cannotSend: string | null;
  /** Continue with Google is offered only where the server has this
      (D27-207). Public: it names this system to Google. */
  googleClientId: string | null;
  /** What the hotel offers behind the code (D21-63): "spa", "laundry". */
  offers: string[];
}

const KEY = (token: string) => `guest-unlock:${token.slice(0, 12)}`;

/** This phone's unlock for this link, if it has one. */
function heldUnlock(token: string): string | null {
  try { return localStorage.getItem(KEY(token)); } catch { return null; }
}

function keepUnlock(token: string, unlock: string): void {
  try { localStorage.setItem(KEY(token), unlock); } catch { /* a private tab: asked again */ }
}

/** Dropped when the door refuses it - expired, or a new guest in the room. */
export function dropUnlock(token: string): void {
  try { localStorage.removeItem(KEY(token)); } catch { /* nothing held */ }
}

const at =(token: string, rest = "") => `/api/guest/${encodeURIComponent(token)}${rest}`;

const withUnlock = (token: string, init: RequestInit = {}): RequestInit => {
  const unlock = heldUnlock(token);
  return unlock
    ? { ...init, headers: { ...(init.headers ?? {}), authorization: `Guest ${unlock}` } }
    : init;
};

export const openGuestPage = (token: string): Promise<GuestPageView> =>
  api<GuestPageView>(at(token), withUnlock(token));

/** Where this link's hotel logo is (D27-223): the hotel's own, else the
    group's. An <img> asks it with no unlock - it is the hotel's picture,
    not the stay's - and the door answers the picture or its one sentence. */
export const logoAddress = async (token: string): Promise<string> =>
  `${await apiBase()}${at(token, "/logo")}`;

/* The door's own sentence - where it went, or why it did not (no mobile
   number on the booking, five an hour, WhatsApp refused). The screen
   prints it and decides nothing from it. */
export interface CodeAnswer {
  sent: boolean;
  message?: string;
  /** DEVELOPMENT ONLY (D27-105): the code itself, from a server started
      with GUEST_CODE_ON_SCREEN beside ALLOW_DEV_AUTH. Drawn only in a
      development build; a built app that carries the name fails the build. */
  devCode?: string;
}

/** The guest's choice, and nothing typed (D27-207, D27-210): the code goes
    to the number or the email the booking carries. Nothing is sent until
    the guest presses one - opening the page sends nothing. */
export const sendCode = (token: string, by: "whatsapp" | "email"): Promise<CodeAnswer> =>
  api<CodeAnswer>(at(token, "/code"), { method: "POST", body: JSON.stringify({ by }) });

export async function verifyCode(token: string, code: string): Promise<{ verified: boolean }> {
  const answer = await api<{ verified: boolean; unlock?: string }>(at(token, "/verify"), {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (answer.verified && answer.unlock) keepUnlock(token, answer.unlock);
  return { verified: answer.verified };
}

/** Continue with Google (D27-207): Google's signed answer, posted as it
    came. The door checks it and compares its address with the booking's;
    a match hands back the same unlock as a right code. */
export async function verifyWithGoogle(token: string, credential: string): Promise<{ verified: boolean }> {
  const answer = await api<{ verified: boolean; unlock?: string }>(at(token, "/google"), {
    method: "POST",
    body: JSON.stringify({ credential }),
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
  /** The guest's own yes to offers (D25-39, opt-in): recorded at once. */
  offersAgreed?: boolean;
  /* D27-169: the booking's, and a foreign guest's Form III (147). */
  expectedArrival?: string;
  specialRequests?: string;
  /** "IN" for an Indian national, else the country as they wrote it. */
  nationality?: string;
  gender?: string;
  dateOfBirth?: string;
  passportIssuedOn?: string;
  passportIssuePlace?: string;
  passportIssueCountry?: string;
  visaType?: string;
  visaIssuedOn?: string;
  visaIssuePlace?: string;
  visaIssueCountry?: string;
  arrivedFrom?: string;
  previousStay?: string;
  purpose?: string;
  purposeOther?: string;
  arrivedInIndiaOn?: string;
  arrivalPort?: string;
  mobileInIndia?: string;
  phoneInIndia?: string;
  mobileAbroad?: string;
  phoneAbroad?: string;
  employedInIndia?: boolean;
  refAddress?: string;
  refCity?: string;
  refState?: string;
  refPincode?: string;
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
  /** 'desk' is a message to the front desk (D23-14), not a request. */
  kind: "spa" | "laundry" | "desk";
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

/** One line of the guest's conversation with the desk (D27-224): their own
    message, or the desk's reply - which carries no name. Newest first. */
export type ThreadLine =
  | { from: "you"; what: string; status: "open" | "done" | "declined"; at: string }
  | { from: "desk"; what: string; at: string };

export const getThread = (token: string): Promise<{ thread: ThreadLine[] }> =>
  api(at(token, "/messages"), withUnlock(token));

/* ── The ID photo (D27-207 to D27-212) ────────────────────────────────
   Optional, after the details are sent. The guest SENDS and never reads
   back: the door tells this page only that a photo is there and since
   when, or that the desk removed it and why. */
export interface IdPhotoState {
  /** Whether this hotel takes ID photos at all. */
  offered: boolean;
  /** Only while the details wait for the desk. */
  maySend: boolean;
  /** The hotel's own number, for the notice. */
  contact: string | null;
  sent: { sides: ("front" | "back")[]; at: string } | null;
  /** The desk's reason, as the door words it for the guest. */
  removed: string | null;
}

export const getIdPhoto = (token: string) =>
  api<IdPhotoState>(at(token, "/id-photo"), withUnlock(token));

/** NOT THROUGH `api()`, which always sends JSON: a photo goes as a form.
    It is called only after the guest has ticked the consent, and says so. */
export async function sendIdPhoto(
  token: string, photos: { front: Blob; back: Blob | null },
): Promise<{ sent: boolean }> {
  const form = new FormData();
  form.append("front", photos.front, "front");
  if (photos.back) form.append("back", photos.back, "back");
  form.append("agreed", "yes");
  return upload<{ sent: boolean }>(at(token), "/id-photo", form, withUnlock(token).headers);
}
