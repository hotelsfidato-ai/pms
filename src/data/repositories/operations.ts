/* `operations` no longer touches the in-memory store at all — not to
   read and not to write. Every one of the five flows goes to Postgres,
   and `Posting` is the only thing left that this module takes from
   there: a type, not data. */
import type { Posting } from "../store";
import { isDemoProperty } from "../fixtures/property";
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

const guard = isDemoProperty;

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
    idCaptured: boolean;
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
  if (!guard(hotelId)) return [];
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

/** Object surface, so either import convention resolves. */
export const operationsRepo = {
  getFolioPostings, getFolioBalance,
  checkInAllowed, assignableRooms, checkIn,
  postCharge, reverseChargeAllowed, reverseCharge,
  settle, checkOutAllowed, checkOut,
  createWalkIn,
  listHousekeeping, markRoom,
};
