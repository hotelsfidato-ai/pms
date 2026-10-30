/* `operations` no longer touches the in-memory store at all — not to
   read and not to write. Every one of the five flows goes to Postgres,
   and `Posting` is the only thing left that this module takes from
   there: a type, not data. */
import type { Posting } from "@/data/repositories/types";
import { listAllRooms, blockedFor } from "@/data/repositories/rooms";
import { getStay, listInHouse } from "./stays";
import { api, ApiError } from "@/lib/api";
import { canCheckIn } from "@/lib/rules";
import type { Stay, Permitted } from "@/data/repositories/types";
import type { OperationResult } from "@/data/repositories/result";
import { refuse } from "@/data/repositories/result";


/* ══════════════════════════════════════════════════════════════════
   OPERATIONS — the writes behind the five flows

   Every one takes `hotelId` first and refuses a hotel it does not
   hold. Every one consults `src/lib/rules.ts` before acting, so the
   rule that disables a button in the interface is the same rule that
   refuses the write.
   ══════════════════════════════════════════════════════════════════ */

export type { Posting };




/* ── A · Arrival → in house ───────────────────────────────────────── */

export async function checkInAllowed(
  hotelId: string, stayId: string, businessDate: string,
): Promise<Permitted> {
  /* Reads the SAME source the write does.

     This read the in-memory store while `checkIn` had moved onto HTTP,
     so it looked up a Postgres uuid in a store that has never seen
     one, found nothing, and disabled the button — permanently, with
     "Reservation not found." A clerk would have seen a check-in they
     could never perform and no way to find out why.

     A gate that consults a different source from the action it guards
     is not a gate. */
  const stay = await getStay(hotelId, stayId);
  if (!stay) return { allowed: false, reason: "Reservation not found." };
  return canCheckIn(stay, businessDate);
}

/** Every room, this type's first, and whether a guest may be put in it. */
export async function assignableRooms(
  hotelId: string, roomType: string, businessDate: string,
  /** The room this booking is ALREADY on, if any: its own guest still
      in it does not refuse it. */
  currentRoom?: string | null,
  /** The stay's departure: a room blocked on any night from tonight to it
      is not offered (D27-339). */
  departure?: string,
) {
  /* Which rooms a guest of this type can be put in tonight, and why
     not, for the ones they cannot. Both lists come from the API now —
     the room inventory and who is in it — because a picker built from
     the store would have offered rooms the server then refused. */
  const [rooms, inHouse] = await Promise.all([
    listAllRooms(hotelId),
    /* The desk's read, not every booking ever made (D27-313): the Check
       in button waited ~3.5 s for 793 rows on every open. */
    listInHouse(hotelId, businessDate),
  ]);

  /* Occupied means somebody has CHECKED IN and not left. Not "a
     booking covers tonight" — that would have counted the arrival
     being checked in as the reason it could not be checked in, and it
     did: the guest's own pre-assigned room came back disabled.

     Status, not dates. Third time this has bitten (MEMORY.md 3). */
  const takenBy = new Map(inHouse.map((s) => [s.roomNumber, s.guest]));

  return rooms
    /* EVERY TYPE, THE BOOKED TYPE FIRST (the owner's D27-330 (1)). This
       filtered to the booked type plus the room the booking was already on
       (an upgrade Assign room gave), so an upgrade at the desk meant Assign
       room first. Now the desk picks any room; the screen marks another
       type "(different type)" and the server takes it as an upgrade, the
       booked rate kept (D27-328, FD-34). A stable sort: each type keeps the
       rooms' own order. */
    .sort((a, b) => Number(b.type === roomType) - Number(a.type === roomType))
    .map((r) => {
      /* The seam keeps the name the screens already read. The API calls
         it `status`; the store called it `housekeeping`, and CheckInFlow
         was written against the store. Renaming it here would have been
         the first time this swap forced a SCREEN to change — which is
         the one thing the checkpoint is measuring. Mapping belongs in
         the repository; that is what a seam is for. */
      const base = { ...r, housekeeping: r.status, label: undefined as string | undefined };

      if (r.status === "out-of-service") {
        return { ...base, allowed: false, reason: "Held out of service." };
      }
      const blocked = departure ? blockedFor(r, businessDate, departure) : null;
      if (blocked) return { ...base, allowed: false, reason: blocked };
      if (r.status === "dirty") {
        return { ...base, allowed: false, reason: "Not cleaned yet." };
      }
      const occupant = takenBy.get(r.number);
      /* Its state in words (QA FD-10): an occupied room read "clean". */
      if (occupant && r.number !== currentRoom) {
        return { ...base, allowed: false, reason: `${occupant} is in this room.`, label: "Occupied" };
      }
      if (occupant) {
        return { ...base, allowed: true, reason: `${occupant} has not left this room yet.`, label: "Guest still in" };
      }
      return { ...base, allowed: true, reason: undefined as string | undefined };
    });
}

export interface EarlyArrival {
  isEarly: boolean;
  checkInTime: string;
  checkOutTime: string;
  /** Null when the property does not charge. Not zero — a dash on
      screen, because "we do not charge" and "we charge nothing" are
      different sentences and only one of them is a decision. */
  charge: number | null;
  lateCharge: number | null;
  /** Whether the server will take a waive of either charge from this
      person - its own `mayWaive`, asked for them. */
  mayWaive: boolean;
}

/** The property's clock and its charges, from the server. */
export async function earlyArrival(
  hotelId: string,
): Promise<EarlyArrival | null> {
  if (!hotelId) return null;
  try {
    return await api<EarlyArrival>(`/api/hotels/${hotelId}/early-arrival`);
  } catch {
    return null;
  }
}

/** A check-out before the booked departure (the owner's D27-315): the server's
    answer, by the night audit's own rule. Null when no night is freed. */
export interface LeavingEarly {
  departure: string; today: string; newDeparture: string;
  nightsFreed: number; bookingSite: boolean;
}

export async function leavingEarly(
  hotelId: string, stayId: string,
): Promise<LeavingEarly | null> {
  const r = await api<{ leavingEarly: LeavingEarly | null }>(
    `/api/hotels/${hotelId}/stays/${stayId}/leaving-early`);
  return r.leavingEarly;
}

export async function checkIn(
  hotelId: string,
  stayId: string,
  input: {
    roomNumber: string;
    adults: number;
    children: number;
    ratePlan: string;
    /**
     * The DOCUMENT, not a claim that one was seen.
     *
     * This was `idCaptured: boolean` — the flow flipped it, the API
     * filed it into a note, and `guest_documents` was never written
     * to. Capture is now derived from whether a type and a number
     * actually arrive, which is not a thing a client can assert.
     */
    identity?: {
      idType?: string;
      idNumber?: string;
      nationality?: string;
      /* And Form III's person fields (the guests service's, D27-25). */
      [field: string]: string | undefined;
    };
    /** Form III's questions about this visit, for a foreign guest. */
    visit?: Record<string, string | boolean>;
    idSkipReason?: string;
    /* Why the room was given before the property's check-in time, and
       whether the charge for it was waived. The server decides WHETHER
       this is early — the clock is the property's, not the tablet's,
       and a device with the wrong time must not be able to make an
       early arrival look ordinary. */
    earlyReason?: string;
    waiveEarly?: boolean;
    /** "Guest agreed to offers", asked face to face (D25-39). */
    offersAgreed?: boolean;
    /** D27-193: the clerk confirmed a move of the arrival by more than a day. */
    confirmMove?: boolean;
    /** D27-246: "Prepaid on the booking site", for a booking site's booking. */
    prepaidOnSite?: boolean;
    businessDate: string;
    /* ⚠ NO `user`. This sent the literal "front desk", and so did the
       walk-in below (FD-2). Neither route ever read it: the server takes
       the person from the signed-in session (`app.current_user_id()`),
       which a browser cannot overstate. A name sent from here would be a
       second answer to "who did this", and the one that could be wrong. */
  },
): Promise<OperationResult<Stay>> {
  /* Writes to Postgres, in ONE transaction, and the DATABASE refuses.
     `src/lib/rules.ts` still disables the button — that is what a clerk
     should see — but a rule enforced only in the browser is a
     suggestion, and a suggestion is not what stops a room being sold
     twice. The refusal comes back as a sentence, not a constraint
     name, because a clerk has to act on it. */
  try {
    await api<{ ok: true }>(
      `/api/hotels/${hotelId}/stays/${stayId}/check-in`,
      { method: "POST", body: JSON.stringify(input) },
    );
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  /* Read back rather than assume. The server decides the final state —
     it may have released a pre-assignment or corrected occupancy — and
     returning a locally-guessed object is how a screen shows something
     the database does not agree with. */
  const updated = await getStay(hotelId, stayId);
  if (!updated) return refuse("Checked in, but the reservation could not be re-read.");
  return { ok: true, data: updated };
}

/* ── C · Departure → settle → check out ───────────────────────────── */

export async function checkOut(
  hotelId: string, stayId: string,
  /* ⚠ THIS TOOK ONLY `user` AND SENT ONLY `user`.
     The server refuses a late departure without a reason — correctly,
     and with the reason on screen — and there was no way to give it
     one. So the refusal was a DEAD END: press the button, read why it
     will not work, press it again. Five identical toasts stacked up in
     the owner's screenshot, which is exactly what that loop looks like.

     A guard that cannot be satisfied is not a guard, it is a wall. */
  late?: { lateReason?: string; waiveLate?: boolean;
           /** Why a guest leaves before the booked departure (D27-315). */
           earlyReason?: string },
  /** Form III: where a foreign guest goes next (D27-25). */
  nextDestination?: string,
): Promise<OperationResult<Stay>> {
  /* The BALANCE decides, server-side. A guest cannot walk out owing
     money without somebody deciding to let them, and that decision is
     a transfer to the city ledger — which is itself a posting, not a
     silent exception.

     Check-out also releases the room, marks it vacant and marks it
     DIRTY, so it reaches housekeeping the moment the guest walks out
     rather than the next time somebody remembers. */
  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/check-out`, {
      method: "POST",
      body: JSON.stringify({ ...late, ...(nextDestination ? { nextDestination } : {}) }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      /* The marker rides through with the reason. Without it the panel
         would have to recognise a late departure by reading the
         sentence, and the sentence is not an interface. */
      const body = error.body as
        { reason?: string; needs?: "late-reason" | "early-reason" | "next-destination" } | undefined;
      return body?.needs
        ? { ok: false, reason: body.reason ?? error.message, needs: body.needs }
        : refuse(body?.reason ?? error.message);
    }
    throw error;
  }

  const updated = await getStay(hotelId, stayId);
  if (!updated) return refuse("Checked out, but the reservation could not be re-read.");
  return { ok: true, data: updated };
}

/* ── D · Walk-in ──────────────────────────────────────────────────────
   The walk-in is New booking's one page opened from an empty room
   (D27-163): the booking call, then the check-in above. The server's
   POST /walk-ins, which no screen called after that, was removed on
   30 September (Rule 2b). */

/**
 * Give a booking a room ahead of arrival.
 *
 * Check-in assigns a room AT arrival; this is the night before. The
 * tape chart's "Assign room" button had no handler at all, so the only
 * way a reservation ever got a room was by checking the guest in.
 *
 * Every refusal comes back with its reason: the room is taken for part
 * of the stay, it is out of service, the guest already has one. Rule 6.
 */
export async function assignRoom(
  hotelId: string, stayId: string, roomNumber: string,
): Promise<
  | { ok: true; room: string; guest: string; typeChanged: boolean; typeName: string }
  | { ok: false; reason: string }
> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}/assign`, {
      method: "POST",
      body: JSON.stringify({ roomNumber }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/**
 * Moves a guest from one room to another partway through a stay.
 *
 * `from` is the first night in the NEW room. Everything before it
 * stays with the old room, because the guest slept there.
 *
 * THE MONEY IS NOT TOUCHED unless `agreedRate` is given. The night
 * audit posts the reservation's agreed rate, snapshotted at booking
 * and never looked up again, so a move reprices nothing by itself —
 * and nights already posted are history in any case. Passing a rate
 * changes what the audit charges from tonight forward - and, on the
 * arrival day, tonight's night posted at check-in (D27-205).
 */
export async function moveRoom(
  hotelId: string, stayId: string,
  input: {
    roomNumber: string; from: string;
    reason?: "move" | "upgrade" | "downgrade" | "fault" | "group_consolidation";
    agreedRate?: number;
  },
): Promise<
  | { ok: true; guest: string; from: string; to: string;
      nightsBefore: number; nightsAfter: number;
      typeChanged: boolean; typeName: string; rateChanged: boolean }
  | { ok: false; reason: string }
> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}/move`, {
      method: "POST", body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/**
 * Changes a booking's dates or party size.
 *
 * Every field is optional and absent means UNCHANGED — the server
 * reads the current row and fills the gaps, so a form that does not
 * send a field cannot shorten a stay to nothing.
 *
 * The room hold moves with the booking. If the room is taken for the
 * nights being added, nothing changes at all: the whole call rolls
 * back, and the refusal says to move them first.
 *
 * The rate is deliberately not amendable here. `agreed_rate` is
 * snapshotted at booking, so extra nights are charged at the rate the
 * guest agreed to.
 */
export async function amendStay(
  hotelId: string, stayId: string,
  input: { checkIn?: string; checkOut?: string;
           adults?: number; children?: number },
): Promise<
  | { ok: true; guest: string; checkIn: string; checkOut: string;
      adults: number; children: number;
      nightsBefore: number; nightsAfter: number; roomHeld: string | null }
  | { ok: false; reason: string }
> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}`, {
      method: "PATCH", body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/**
 * Takes a booking out of its room without putting it in another.
 * The assignment row stays — releasing is not deleting, and "who was
 * in 203 last Tuesday" has to keep an answer.
 */
export async function unassignRoom(
  hotelId: string, stayId: string,
): Promise<{ ok: true; room: string } | { ok: false; reason: string }> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}/unassign`, {
      method: "POST", body: JSON.stringify({}),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/* ── Void — which is not cancel ────────────────────────────────────
   Cancelled HAPPENED and was undone: it may carry a cancellation
   charge, and it belongs in cancellation statistics because a guest
   did something a hotel wants to measure.

   Void NEVER HAPPENED. A duplicate, a test, a booking typed against
   the wrong property. It must stay out of those statistics too, or it
   inflates a number somebody makes decisions from.

   Neither is deleted. A booking that vanishes is one nobody can
   account for. */

export async function voidStay(
  hotelId: string, stayId: string, reason: string,
): Promise<OperationResult<{ reference: string }>> {
  try {
    const body = await api<{ ok: true; data: { reference: string } }>(
      `/api/hotels/${hotelId}/stays/${stayId}/void`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    return { ok: true, data: body.data };
  } catch (error) {
    if (error instanceof ApiError) {
      /* The server's refusal, verbatim. It knows things this side does
         not — whether the folio has been posted to, whether the guest
         already arrived — and its wording tells the clerk what to do
         instead. Replacing it with "could not void" throws that away. */
      const p = error.body as { reason?: string } | undefined;
      return refuse(p?.reason ?? error.message);
    }
    throw error;
  }
}

/* The meal plans the desk offers, the code with its words (the owner's
   D27-164). RO is EP and is not offered; a booking already on RO keeps it:
   its "Room Only" is added back as its own choice. */
export const MEAL_PLAN_CHOICES = [
  { value: "EP", label: "EP · Room only" },
  { value: "CP", label: "CP · Room + breakfast" },
  { value: "MAP", label: "MAP · Room + breakfast + one meal" },
] as const;

export const mealPlanChoices = (current: string) =>
  current === "Room Only"
    ? [...MEAL_PLAN_CHOICES, { value: "Room Only", label: "RO · Room only" }]
    : MEAL_PLAN_CHOICES;

/** Whether this stay checks in by express (D27-236 3.4, D27-242): an Indian
    guest whose ID the desk confirmed from THIS stay's online check-in. The
    server decides; the document comes back masked to its last four. */
export async function expressCheckIn(
  hotelId: string, stayId: string, prepaidOnSite?: boolean,
): Promise<{
  express: boolean; document?: { type: string; number: string };
  /** The advance still owed, in the server's words (D27-243 3.3); null when none. */
  advance?: { owed: number; words: string } | null;
  /** A booking-site booking, and its "Prepaid on the booking site" tick (D27-246). */
  bookingSite?: boolean; prepaidOnSite?: boolean;
}> {
  try {
    return await api(`/api/hotels/${hotelId}/stays/${stayId}/express-check-in`
      + (prepaidOnSite === undefined ? "" : `?prepaid=${prepaidOnSite}`));
  } catch {
    return { express: false };
  }
}

/** Save the front desk's rules (the owner's D27-243; Settings › Operations).
    The server refuses a wrong value in a sentence. */
export async function saveDeskRules(
  hotelId: string, rules: import("@/lib/api").DeskRules,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelId}/front-desk`, { method: "PATCH", body: JSON.stringify(rules) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: error.message };
    throw error;
  }
}
