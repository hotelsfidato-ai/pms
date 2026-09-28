import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE SPA — the seam

   Treatments, a day diary, and a booking taken at the desk from a
   telephone call (D18-6). Everything here is one call to
   `api/src/modules/spa/spa.ts`; nothing in this file decides anything.

   NO PRICE IS INVENTED. `price` and `amount` are `number | null`, and
   null means NOBODY HAS PRICED THIS — a dash on the screen, never ₹0
   and never "free". The server keeps the null all the way out
   (spa.ts: "NULL STAYS NULL ALL THE WAY TO THE SCREEN"), so the only
   way to lose it is to coalesce it here. Nothing here does.

   ⚠ A TIME BELONGS TO THE PROPERTY (113, root MEMORY 297). The diary's
   times arrive as `YYYY-MM-DDTHH:MM` ALREADY ON THE HOTEL'S CLOCK —
   `app.hotel_clock` wrote them, and they carry NO offset on purpose.
   So `new Date(startsAt)` would read them in the BROWSER's zone, and a
   laptop in London would move every appointment at Akkalkot by five and
   a half hours. That is BQ-8 again. `clockTime` and `clockDate` below
   read the string and never build a Date, which is why this module does
   not use `format.ts` for these two — `timeOnly()` and `dateShort()`
   parse first.
   ══════════════════════════════════════════════════════════════════ */

/** What a property sells. `price` is null until somebody types one. */
export interface SpaTreatment {
  id: string;
  name: string;
  minutes: number;
  /** NULL means unpriced — a dash, never 0, and it cannot be booked for money. */
  price: number | null;
  isActive: boolean;
  notes: string | null;
}

/** A name, not an account (D18-8). No therapist signs in. */
export interface SpaTherapist {
  id: string;
  name: string;
  isActive: boolean;
}

export interface SpaAppointment {
  id: string;
  status: string;
  /** `YYYY-MM-DDTHH:MM` on the PROPERTY's clock. Read it, do not parse it. */
  startsAt: string;
  endsAt: string;
  treatment: string | null;
  minutes: number | null;
  guestName: string | null;
  room: string | null;
  /** What was agreed when it was booked. Null is unpriced. */
  amount: number | null;
  /** "room" or "spa" once it is closed; null while it is still to happen. */
  settlement: string | null;
}

export interface SpaDiaryTherapist {
  id: string;
  name: string;
  /** Empty for a therapist with nothing booked — "who is free" is the
      question being asked, so an empty day is an answer and not an
      omission. */
  appointments: SpaAppointment[];
}

export interface SpaDiary {
  businessDate: string;
  from: string;
  to: string;
  therapists: SpaDiaryTherapist[];
}

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT — the menu's copy

   ⚠ A COPY of `SPA_BOOK_ROLES` and `SPA_LIST_ROLES` in
   `api/src/modules/spa/spa.ts`, which says so itself. THE SERVER IS
   THE ENFORCEMENT: it refuses every route on its own, because a hidden
   entry is still a URL anybody can type (MEMORY 250, 263). These lists
   only stop offering a door that would be refused.

   The owner's D18-21, 18 September: housekeeping SEES the diary and
   does not touch it; reception books and closes; the owner, an
   administrator or the GM set the price list.

   Who SEES the diary is the matrix again, `canAccess(role, "spa")`:
   SPA-2 took the grant off the accountant and the viewer, whom the
   server always refused, and api/test/modules/spa/spa.test.ts holds the
   matrix to `SPA_READ_ROLES`.
   ══════════════════════════════════════════════════════════════════ */

export const TAKES_A_BOOKING: readonly string[] =
  ["owner", "admin", "gm", "hotel_manager", "front_desk"];

export const SETS_THE_LIST: readonly string[] = ["owner", "admin", "gm"];

/* ══════════════════════════════════════════════════════════════════
   THE PROPERTY'S CLOCK, READ AS A STRING

   Both take what the server sent and slice it. No Date is built, so no
   browser zone can move anything. A string that is not the shape the
   server promised reads as a dash rather than throwing — a bad value in
   one table cell must not unmount the screen (`format.ts` learnt that
   the hard way).
   ══════════════════════════════════════════════════════════════════ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "11:00" at the hotel → "11:00 AM". */
export function clockTime(at: string | null | undefined): string {
  if (!at || at.length < 16) return "-";
  const hours = Number(at.slice(11, 13));
  const minutes = at.slice(14, 16);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return "-";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "2026-09-19" → "19 Sep 2026". Takes a diary time or a bare date. */
export function clockDate(on: string | null | undefined): string {
  if (!on || on.length < 10) return "-";
  const month = MONTHS[Number(on.slice(5, 7)) - 1];
  const day = Number(on.slice(8, 10));
  if (!month || !Number.isInteger(day)) return "-";
  return `${day} ${month} ${on.slice(0, 4)}`;
}

/** The day before or after, in UTC arithmetic only — `new Date("…T00:00")`
    is the browser's midnight, and `.toISOString()` then hands back the day
    BEFORE at every property east of Greenwich. */
export function shiftDay(on: string, days: number): string {
  const at = new Date(Date.UTC(
    Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8, 10)) + days));
  return Number.isNaN(at.getTime()) ? on : at.toISOString().slice(0, 10);
}

/* ══════════════════════════════════════════════════════════════════
   THE READS

   ⚠ THEY THROW, and they must. A read that cannot reach the server must
   never end in `catch { return [] }`, because the screen would then draw
   "nothing booked today" at a property whose diary is full — the fault
   STO-2 and POS-4 were both filed for.

   A property with the spa switched off lands here too, as the server's
   own 403 and its own sentence. The screen shows that sentence.
   ══════════════════════════════════════════════════════════════════ */

/** One day of the diary, or a window. Both default to the property's
    business date on the server — never to a date this browser picked. */
export async function getSpaDiary(
  code: string, from?: string, to?: string,
): Promise<SpaDiary> {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const suffix = query.toString();
  return api<SpaDiary>(`/api/hotels/${code}/spa${suffix ? `?${suffix}` : ""}`);
}

/** The price list, retired treatments included — this is also the screen
    somebody puts one back from. */
export async function getTreatments(code: string): Promise<SpaTreatment[]> {
  const out = await api<{ treatments: SpaTreatment[] }>(
    `/api/hotels/${code}/spa/treatments`);
  return out.treatments;
}

export async function getTherapists(code: string): Promise<SpaTherapist[]> {
  const out = await api<{ therapists: SpaTherapist[] }>(
    `/api/hotels/${code}/spa/therapists`);
  return out.therapists;
}

/* ── The writes ───────────────────────────────────────────────────
   Every one answers `{ ok }` or the server's own sentence. NOTHING
   HERE REWRITES A REFUSAL: the diary's overlap refusal names the
   therapist, the guest, the treatment and the hour standing in the way,
   and "That time is unavailable" would throw away the only half a
   receptionist on a telephone can act on. Same for the tax refusal,
   which names where GST is set (D18-21). ═══════════════════════════ */

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** A price may be left out, and left out is not zero: the treatment is
    unpriced until somebody types a figure, shows "-", and cannot be
    booked for money. `price: null` takes a priced one back to unpriced. */
export async function addTreatment(
  code: string,
  input: { name: string; minutes: number; price?: number | null; free?: boolean; notes?: string },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/treatments`, "POST", input);
}

export async function changeTreatment(
  code: string, id: string,
  input: { name?: string; minutes?: number; price?: number | null; free?: boolean; isActive?: boolean },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/treatments/${id}`, "PATCH", input);
}

export async function addTherapist(
  code: string, name: string,
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/therapists`, "POST", { name });
}

export async function changeTherapist(
  code: string, id: string, input: { name?: string; isActive?: boolean },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/therapists/${id}`, "PATCH", input);
}

/** Taken by the desk, against a stay, always (D18-6).

    `startsAt` is what a person typed on a screen AT THE HOTEL —
    `YYYY-MM-DDTHH:MM`, no offset, read on the property's clock by
    `app.hotel_moment`. Sending an offset here, or an ISO string this
    browser made, is how an eleven o'clock massage lands at half past
    four. There is no `endsAt`: the length comes from the treatment, so
    no caller can book ninety minutes into a thirty-minute slot. */
export async function bookTreatment(
  code: string,
  input: { stayId: string; treatmentId: string; therapistId: string; startsAt: string },
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/appointments`, "POST", input);
}

/** A cancellation says why — the line somebody asks about a month later. */
export async function cancelAppointment(
  code: string, id: string, reason: string,
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/spa/appointments/${id}/cancel`, "POST", { reason });
}

/** The treatment was given: it goes onto the guest's room bill (D18-22).
    There is no settlement to choose — "settled at the spa" is set aside
    by the owner for later, so the server takes no choice and the screen
    offers none. The server refuses an unpriced one, a property with no
    spa tax rule, and a bill that is already closed, each in a sentence. */
export async function closeAppointment(
  code: string, id: string,
): Promise<Result<{ id: string; postingId: string }>> {
  return call(`/api/hotels/${code}/spa/appointments/${id}/close`, "POST", {});
}

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      /* The server's sentence, whether it is 403 ("ask your manager") or
         409 ("that hour is taken"). The two are kept apart all the way to
         the status line precisely so a screen CAN tell them apart; this
         one shows the words either way, and never its own. */
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}
