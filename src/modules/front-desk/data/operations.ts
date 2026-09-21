/* `operations` no longer touches the in-memory store at all — not to
   read and not to write. Every one of the five flows goes to Postgres,
   and `Posting` is the only thing left that this module takes from
   there: a type, not data. */
import type { Posting } from "@/data/repositories/types";
import { listAllRooms } from "@/data/repositories/rooms";
import { getStay, listStays } from "./stays";
import { api, ApiError } from "@/lib/api";
import { canCheckIn, canCheckOut, canConfirmWalkIn } from "@/lib/rules";
import { money } from "@/lib/format";
import type { Stay, Permitted } from "@/data/repositories/types";
import type { OperationResult } from "@/data/repositories/result";
import { refuse } from "@/data/repositories/result";
import { getFolioBalance } from "@/modules/finance";


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

/** Rooms a guest of this type may actually be put in. */
export async function assignableRooms(
  hotelId: string, roomType: string, businessDate: string,
  /** The room this booking is ALREADY on, if any. Always offered,
      whatever its type — see below. */
  currentRoom?: string | null,
) {
  /* Which rooms a guest of this type can be put in tonight, and why
     not, for the ones they cannot. Both lists come from the API now —
     the room inventory and who is in it — because a picker built from
     the store would have offered rooms the server then refused. */
  const [rooms, stays] = await Promise.all([
    listAllRooms(hotelId),
    listStays(hotelId),
  ]);

  /* Occupied means somebody has CHECKED IN and not left. Not "a
     booking covers tonight" — that would have counted the arrival
     being checked in as the reason it could not be checked in, and it
     did: the guest's own pre-assigned room came back disabled.

     Status, not dates. Third time this has bitten (MEMORY.md 3). */
  const takenBy = new Map<string, string>();
  for (const s of stays) {
    if (s.status === "in-house" || s.status === "due-out") {
      takenBy.set(s.roomNumber, s.guest);
    }
  }
  void businessDate;

  return rooms
    /* THE ROOM THEY ARE ALREADY ON IS ALWAYS OFFERED. Filtering to the
       booked type alone hid it whenever the two disagreed — a Deluxe
       booking pre-assigned to a Superior, which the desk does when it
       upgrades somebody or works around a fault.

       The flow seeds its selection from `stay.roomNumber`, so the room
       was SELECTED AND ABSENT: the picker showed eight rooms, none of
       them highlighted, and the one the desk had already chosen was
       nowhere. Nothing said why.

       A decision somebody already made is not a decision this screen
       gets to hide. */
    .filter((r) => r.type === roomType
      || (currentRoom != null && r.number === currentRoom))
    .map((r) => {
      /* The seam keeps the name the screens already read. The API calls
         it `status`; the store called it `housekeeping`, and CheckInFlow
         was written against the store. Renaming it here would have been
         the first time this swap forced a SCREEN to change — which is
         the one thing the checkpoint is measuring. Mapping belongs in
         the repository; that is what a seam is for. */
      const base = { ...r, housekeeping: r.status };

      if (r.status === "out-of-service") {
        return { ...base, allowed: false, reason: "Held out of service." };
      }
      if (r.status === "dirty") {
        return { ...base, allowed: false, reason: "Not cleaned yet." };
      }
      const occupant = takenBy.get(r.number);
      if (occupant && r.number !== currentRoom) {
        return { ...base, allowed: false, reason: `${occupant} is in this room.` };
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
      passportExpiry?: string;
      visaNumber?: string;
      visaExpiry?: string;
      addressLine?: string;
      city?: string;
      country?: string;
    };
    idSkipReason?: string;
    /* Why the room was given before the property's check-in time, and
       whether the charge for it was waived. The server decides WHETHER
       this is early — the clock is the property's, not the tablet's,
       and a device with the wrong time must not be able to make an
       early arrival look ordinary. */
    earlyReason?: string;
    waiveEarly?: boolean;
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

export async function checkOutAllowed(hotelId: string, stayId: string): Promise<Permitted> {
  const stay = await getStay(hotelId, stayId);
  if (!stay) return { allowed: false, reason: "Reservation not found." };
  /* A stay with no bill owes nothing, so it may check out (D17-16 changes
     what is SHOWN, not what is owed). */
  return canCheckOut(stay, (await getFolioBalance(hotelId, stayId)) ?? 0, money);
}

export async function checkOut(
  hotelId: string, stayId: string,
  /* ⚠ THIS TOOK ONLY `user` AND SENT ONLY `user`.
     The server refuses a late departure without a reason — correctly,
     and with the reason on screen — and there was no way to give it
     one. So the refusal was a DEAD END: press the button, read why it
     will not work, press it again. Five identical toasts stacked up in
     the owner's screenshot, which is exactly what that loop looks like.

     A guard that cannot be satisfied is not a guard, it is a wall. */
  late?: { lateReason?: string; waiveLate?: boolean },
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
      body: JSON.stringify({ ...late }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      /* The marker rides through with the reason. Without it the panel
         would have to recognise a late departure by reading the
         sentence, and the sentence is not an interface. */
      const body = error.body as
        { reason?: string; needs?: "late-reason" | "early-reason" } | undefined;
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

/* ── D · Walk-in ──────────────────────────────────────────────────── */


export async function createWalkIn(
  hotelId: string,
  input: {
    guestName: string;
    roomNumber: string;
    nights: number;
    adults: number;
    children: number;
    ratePlan: string;
    rackTariff: number;
    offeredTariff: number;
    overrideReason: string;
    businessDate: string;
    /* No `user` — see checkIn above (FD-2). */
    /* Captured AT THE DESK, because it cannot be back-filled. A month
       later nobody remembers which agent sent a walk-in, and the
       source-mix report is built from exactly this. Optional: a clerk
       with a queue must not be blocked on a field they do not know. */
    businessSource?: string;
    marketSegment?: string;
    salesPerson?: string;
    isSingleLady?: boolean;
    /* The CRM's (docs/briefs/crm.md). Optional, like the booking form's:
       a phone and an email, the returning guest the clerk confirmed
       (D21-20, checked again by the server), and the two ticks - "guest
       agreed to WhatsApp" (D21-72) and "do not send offers" (D21-22). */
    phone?: string;
    email?: string;
    guestId?: string;
    whatsappAgreed?: boolean;
    noOffers?: boolean;
  },
): Promise<OperationResult<Stay>> {
  /* This wrote the new stay into the in-memory store while every
     screen had moved onto HTTP. The walk-in would have reported
     success and then not existed — no error, no row, and a clerk
     looking at an empty chart with a guest standing in front of them.

     The reference is now generated by the DATABASE. `nextReference()`
     produced one client-side, which cannot stay unique the moment two
     clerks take a walk-in at the same desk. */
  const permitted = canConfirmWalkIn(input);
  if (!permitted.allowed) return refuse(permitted.reason!);

  let created: { id: string } | undefined;
  try {
    const out = await api<{ ok: true; data?: { id: string } }>(
      `/api/hotels/${hotelId}/walk-ins`,
      { method: "POST", body: JSON.stringify(input) },
    );
    created = out.data;
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  if (!created?.id) return refuse("Walk-in taken, but it could not be re-read.");
  const stay = await getStay(hotelId, created.id);
  return stay ? { ok: true, data: stay } : refuse("Walk-in taken, but it could not be re-read.");
}

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
 * changes what the audit charges from tonight forward.
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
