/* `operations` no longer touches the in-memory store at all — not to
   read and not to write. Every one of the five flows goes to Postgres,
   and `Posting` is the only thing left that this module takes from
   there: a type, not data. */
import type { Posting } from "./types";
import { listAllRooms, setHousekeeping } from "./rooms";
import { getStay, listStays, getFolio } from "./stays";
import { api, ApiError } from "@/lib/api";
import {
  canCheckIn, canPostCharge, canReverse,
  canCheckOut, canConfirmWalkIn,
  type ChargeCategory, type PaymentMethod,
} from "@/lib/rules";
import { money } from "@/lib/format";
import type { Stay, Permitted } from "./types";


/* ══════════════════════════════════════════════════════════════════
   OPERATIONS — the writes behind the five flows

   Every one takes `hotelId` first and refuses a hotel it does not
   hold. Every one consults `src/lib/rules.ts` before acting, so the
   rule that disables a button in the interface is the same rule that
   refuses the write.
   ══════════════════════════════════════════════════════════════════ */

export type { Posting };


export interface OperationResult<T = void> {
  ok: boolean;
  reason?: string;
  data?: T;
}

const refuse = (reason: string): OperationResult<never> => ({ ok: false, reason });

/* ── Folio reads ──────────────────────────────────────────────────── */

export async function getFolioPostings(hotelId: string, stayId: string): Promise<Posting[]> {
  if (!hotelId || !stayId) return [];
  try {
    return await api<Posting[]>(`/api/hotels/${hotelId}/stays/${stayId}/postings`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}

export async function getFolioBalance(hotelId: string, stayId: string): Promise<number> {
  const folio = await getFolio(hotelId, stayId);
  return folio?.balance ?? 0;
}

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
    .filter((r) => r.type === roomType)
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
      if (occupant) {
        return { ...base, allowed: false, reason: `${occupant} is in this room.` };
      }
      return { ...base, allowed: true, reason: undefined as string | undefined };
    });
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
    businessDate: string;
    user: string;
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

/* ── B · In house → charge ────────────────────────────────────────── */

export async function postCharge(
  hotelId: string,
  stayId: string,
  input: {
    category: ChargeCategory;
    description: string;
    amount: number;
    taxable: boolean;
    businessDate: string;
    user: string;
  },
): Promise<OperationResult<Posting>> {
  /* The tax rate comes from the PROPERTY, server-side — `taxOn()` in
     src/lib/rules.ts still shows the clerk what will be charged, but
     the figure that lands in the ledger is computed where the rate
     lives. GST is a state subject; a constant in the browser is the
     wrong place for it. */
  /* The browser's copy of the rule answers instantly and without a
     round trip. It is not the enforcement — the server refuses too —
     but a clerk should not wait on the network to be told a closed
     folio cannot take a charge. */
  const stay = await getStay(hotelId, stayId);
  if (!stay) return refuse("Reservation not found.");
  const permitted = canPostCharge(stay);
  if (!permitted.allowed) return refuse(permitted.reason!);
  if (!input.description.trim()) return refuse("A charge needs a description.");
  if (input.amount === 0) return refuse("A charge of zero is not a charge.");

  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/charges`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const posting = (await getFolioPostings(hotelId, stayId)).at(-1);
  return posting ? { ok: true, data: posting } : { ok: true };
}

export async function reverseChargeAllowed(
  hotelId: string, stayId: string, postingId: string,
): Promise<Permitted> {
  /* Reads the same postings the reversal will act on. A gate that
     consults a different source from the action it guards is not a
     gate — see MEMORY.md 14. */
  const posting = (await getFolioPostings(hotelId, stayId)).find((p) => p.id === postingId);
  if (!posting) return { allowed: false, reason: "Posting not found." };
  return canReverse({ reversed: posting.reversed, isReversal: posting.kind === "reversal" });
}

export async function reverseCharge(
  hotelId: string, stayId: string, postingId: string, user: string,
): Promise<OperationResult<Posting>> {
  /* The reversal is a NEW row. Nothing is edited and nothing is
     deleted, so the posting count goes UP when something is undone —
     which is the opposite of what most people expect and exactly what
     makes the ledger auditable. */
  try {
    await api(
      `/api/hotels/${hotelId}/stays/${stayId}/charges/${postingId}/reverse`,
      { method: "POST", body: JSON.stringify({ user }) },
    );
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const reversal = (await getFolioPostings(hotelId, stayId)).at(-1);
  return reversal ? { ok: true, data: reversal } : { ok: true };
}

/* ── C · Departure → settle → check out ───────────────────────────── */

export async function settle(
  hotelId: string,
  stayId: string,
  input: { method: PaymentMethod; amount: number; businessDate: string; user: string },
): Promise<OperationResult<Posting>> {
  try {
    await api(`/api/hotels/${hotelId}/stays/${stayId}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }

  const posting = (await getFolioPostings(hotelId, stayId)).at(-1);
  return posting ? { ok: true, data: posting } : { ok: true };
}

export async function checkOutAllowed(hotelId: string, stayId: string): Promise<Permitted> {
  const stay = await getStay(hotelId, stayId);
  if (!stay) return { allowed: false, reason: "Reservation not found." };
  return canCheckOut(stay, await getFolioBalance(hotelId, stayId), money);
}

export async function checkOut(
  hotelId: string, stayId: string, user: string,
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
      body: JSON.stringify({ user }),
    });
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
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
    user: string;
    /* Captured AT THE DESK, because it cannot be back-filled. A month
       later nobody remembers which agent sent a walk-in, and the
       source-mix report is built from exactly this. Optional: a clerk
       with a queue must not be blocked on a field they do not know. */
    businessSource?: string;
    marketSegment?: string;
    salesPerson?: string;
    isSingleLady?: boolean;
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

/* ── E · Housekeeping ─────────────────────────────────────────────── */

export interface HousekeepingRoom {
  number: string;
  type: string;
  floor: number;
  housekeeping: string;
  occupied: boolean;
  guest?: string;
  dueOut: boolean;
}

export async function listHousekeeping(
  hotelId: string,
  /* Kept in the signature: every seam function is asked "as at when",
     and a board that silently ignored the date would be the odd one
     out. Occupancy now comes from stay STATUS rather than from
     comparing dates — see below — so nothing here reads it yet. It
     will when the business date stops being a constant (CP11). */
  _businessDate: string,
): Promise<HousekeepingRoom[]> {
  if (!hotelId) return [];
  const live = (await listStays(hotelId)).filter((s) => s.status !== "cancelled");

  /* Rooms from the API, stays from the store — a hybrid, because CP9
     is half-done. It is the ROOM that has moved, and reading it from
     the store here would have left this board writing to Postgres and
     reading its own change back from somewhere else. */
  const rooms = await listAllRooms(hotelId);

  return rooms.map((room) => {
    /* Status, not dates. `departure > businessDate` read a DUE-OUT
       guest as gone, so room 202 appeared under "Vacant clean" with
       the guest's name beside it — a housekeeper would have walked
       into an occupied room. A guest is in the room until they check
       out; that is what due-out means.

       Day-use is not excluded either, for the same reason. A day-use
       guest is in the room until they leave it; that the stay books no
       night is an accounting fact, not a housekeeping one. Room 202
       was the case: a day-use guest sitting in a room the board called
       "Vacant clean".

       This is MEMORY.md defect 3 again, in a second place: derive from
       status, because a date cannot tell you whether the person has
       actually left. */
    const inRoom = live.find(
      (s) => s.roomNumber === room.number &&
        (s.status === "in-house" || s.status === "due-out"),
    );
    const leaving = live.find(
      (s) => s.roomNumber === room.number && s.status === "due-out",
    );
    return {
      number: room.number,
      type: room.type,
      floor: room.floor,
      housekeeping: room.status,
      occupied: !!inRoom,
      guest: inRoom?.guest ?? leaving?.guest,
      dueOut: !!leaving,
    };
  });
}

export async function markRoom(
  hotelId: string, roomNumber: string, state: "clean" | "inspected",
): Promise<OperationResult<HousekeepingRoom>> {
  /* Delegates rather than writing its own copy.
   
     This wrote to the in-memory store while `listHousekeeping` had
     moved its rooms onto HTTP — so a clerk marked a room clean, the
     store changed, Postgres did not, and the next read showed the old
     state with nothing to explain it. Two write paths to one fact is
     one too many.
   
     The refusal is now the DATABASE'S: `src/lib/rules.ts` still
     disables the button, but a rule enforced only in the browser is a
     suggestion. */
  const permitted = await setHousekeeping(hotelId, roomNumber, state);
  return permitted.allowed ? { ok: true } : refuse(permitted.reason ?? "Refused.");
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

/* ══════════════════════════════════════════════════════════════════
   WHOSE ROOMS ARE THESE

   The board listed every room in the property to whoever opened it.
   That is a status display; a housekeeper needs a work list. These
   read and write the named assignment behind it.
   ══════════════════════════════════════════════════════════════════ */

export interface Housekeeper {
  id: string;
  name: string;
  role: string;
}

export interface RoomAssignment {
  room: string;
  staffId: string;
  staffName: string;
  role: string | null;
  note: string | null;
}

export async function listHousekeepers(hotelId: string): Promise<Housekeeper[]> {
  if (!hotelId) return [];
  try {
    return await api<Housekeeper[]>(`/api/hotels/${hotelId}/housekeepers`);
  } catch {
    return [];
  }
}

export async function listRoomAssignments(
  hotelId: string, date?: string,
): Promise<{ date: string; assignments: RoomAssignment[] }> {
  if (!hotelId) return { date: "", assignments: [] };
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return await api<{ date: string; assignments: RoomAssignment[] }>(
    `/api/hotels/${hotelId}/housekeeping/assignments${q}`,
  );
}

export async function assignHousekeeper(
  hotelId: string, roomNumber: string, staffId: string,
  opts: { date?: string; note?: string } = {},
): Promise<{ ok: true; staffName: string; date: string } | { ok: false; reason: string }> {
  try {
    return await api(
      `/api/hotels/${hotelId}/housekeeping/assignments/${encodeURIComponent(roomNumber)}`,
      { method: "PUT", body: JSON.stringify({ staffId, ...opts }) },
    );
  } catch (e) {
    return { ok: false as const,
             reason: e instanceof Error ? e.message : "Not assigned." };
  }
}

export async function unassignHousekeeper(
  hotelId: string, roomNumber: string, date?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  try {
    return await api(
      `/api/hotels/${hotelId}/housekeeping/assignments/${encodeURIComponent(roomNumber)}${q}`,
      { method: "DELETE" },
    );
  } catch (e) {
    return { ok: false as const,
             reason: e instanceof Error ? e.message : "Not unassigned." };
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

/* ══════════════════════════════════════════════════════════════════
   WORK ORDERS

   A dripping tap in 204. A work order is NOT a room block: most take
   no room out of service, and a system that can only say "out of
   order" costs a night's revenue for a tap.
   ══════════════════════════════════════════════════════════════════ */

export interface WorkOrder {
  id: string;
  /** Null for anything that is not a room — a lift, the lobby door. */
  room: string | null;
  title: string;
  detail: string | null;
  category: string;
  priority: string;
  status: string;
  raisedBy: string | null;
  raisedAt: string;
  /** Null while nobody has picked it up, which is a real state. */
  assignedTo: string | null;
  daysOpen: number;
  /** True when the fault also took the room out of service. */
  blocksRoom: boolean;
}

export async function listWorkOrders(
  hotelId: string,
): Promise<{ orders: WorkOrder[]; closed: number }> {
  if (!hotelId) return { orders: [], closed: 0 };
  try {
    return await api<{ orders: WorkOrder[]; closed: number }>(
      `/api/hotels/${hotelId}/work-orders`);
  } catch {
    return { orders: [], closed: 0 };
  }
}

export async function raiseWorkOrder(
  hotelId: string,
  input: { roomNumber?: string; title: string; detail?: string;
           category?: string; priority?: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  return workOrderCall(`/api/hotels/${hotelId}/work-orders`, "POST", input);
}

/** Assign it, start it, or close it. Closing requires saying what was done. */
export async function updateWorkOrder(
  hotelId: string, id: string,
  input: { status?: string; assignedTo?: string | null; resolution?: string },
): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
  return workOrderCall(
    `/api/hotels/${hotelId}/work-orders/${id}`, "PATCH", input);
}

async function workOrderCall(
  path: string, method: string, body: unknown,
): Promise<never | { ok: true; id: string; title: string }
  | { ok: false; reason: string }> {
  try {
    return await api(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
