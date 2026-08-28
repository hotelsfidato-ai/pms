import {
  readStays, readRooms, mutateStay, addStay, addPosting, reversePosting,
  setRoomHousekeeping, balanceOf, postingsFor, nextReference, newStayId,
  type Posting,
} from "../store";
import { PROPERTY_ID } from "../fixtures/property";
import {
  taxOn, canCheckIn, canAssignRoom, canPostCharge, canReverse,
  canCheckOut, canMarkClean, canMarkInspected, canConfirmWalkIn,
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

const guard = (hotelId: string) => hotelId === PROPERTY_ID;
const stayById = (hotelId: string, id: string) =>
  readStays().find((s) => s.id === id && s.hotelId === hotelId) ?? null;

export interface OperationResult<T = void> {
  ok: boolean;
  reason?: string;
  data?: T;
}

const refuse = (reason: string): OperationResult<never> => ({ ok: false, reason });

/* ── Folio reads ──────────────────────────────────────────────────── */

export async function getFolioPostings(hotelId: string, stayId: string): Promise<Posting[]> {
  if (!guard(hotelId) || !stayById(hotelId, stayId)) return [];
  return postingsFor(stayId).map((p) => ({ ...p }));
}

export async function getFolioBalance(hotelId: string, stayId: string): Promise<number> {
  if (!guard(hotelId) || !stayById(hotelId, stayId)) return 0;
  return balanceOf(stayId);
}

/* ── A · Arrival → in house ───────────────────────────────────────── */

export async function checkInAllowed(
  hotelId: string, stayId: string, businessDate: string,
): Promise<Permitted> {
  const stay = stayById(hotelId, stayId);
  if (!stay) return { allowed: false, reason: "Reservation not found." };
  return canCheckIn(stay, businessDate);
}

/** Rooms a guest of this type may actually be put in. */
export async function assignableRooms(hotelId: string, roomType: string, businessDate: string) {
  if (!guard(hotelId)) return [];
  const occupied = new Set(
    readStays()
      .filter(
        (s) =>
          s.status !== "cancelled" && !s.isDayUse &&
          s.arrival <= businessDate && s.departure > businessDate,
      )
      .map((s) => s.roomNumber),
  );
  return readRooms()
    .filter((r) => r.type === roomType)
    .map((r) => {
      const permitted = canAssignRoom({
        housekeeping: r.housekeeping,
        occupied: occupied.has(r.number),
      });
      return { ...r, ...permitted };
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
  const stay = stayById(hotelId, stayId);
  if (!stay) return refuse("Reservation not found.");

  const permitted = canCheckIn(stay, input.businessDate);
  if (!permitted.allowed) return refuse(permitted.reason!);

  const rooms = await assignableRooms(hotelId, stay.roomType, input.businessDate);
  const room = rooms.find((r) => r.number === input.roomNumber);
  if (!room) return refuse("That room is not part of this property.");
  if (!room.allowed && room.number !== stay.roomNumber) return refuse(room.reason!);

  if (!input.idCaptured && !input.idSkipReason?.trim())
    return refuse("Capture the guest's ID, or give a reason for skipping it.");

  const updated = mutateStay(stayId, {
    status: "in-house",
    roomNumber: input.roomNumber,
    adults: input.adults,
    children: input.children,
    ratePlan: input.ratePlan,
    notes: input.idCaptured
      ? stay.notes
      : [stay.notes, `ID not captured — ${input.idSkipReason}`].filter(Boolean).join(" · "),
  });
  if (!updated) return refuse("Could not update the reservation.");

  /* An occupied room is not clean. */
  setRoomHousekeeping(input.roomNumber, "occupied");
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
  const stay = stayById(hotelId, stayId);
  if (!stay) return refuse("Reservation not found.");

  const permitted = canPostCharge(stay);
  if (!permitted.allowed) return refuse(permitted.reason!);
  if (!input.description.trim()) return refuse("A charge needs a description.");
  if (input.amount === 0) return refuse("A charge of zero is not a charge.");

  const posting = addPosting({
    folioId: stayId,
    businessDate: input.businessDate,
    category: input.category,
    description: input.description.trim(),
    amount: input.amount,
    tax: input.taxable ? taxOn(input.amount) : 0,
    kind: "charge",
    user: input.user,
  });
  return { ok: true, data: posting };
}

export async function reverseChargeAllowed(
  hotelId: string, stayId: string, postingId: string,
): Promise<Permitted> {
  if (!guard(hotelId)) return { allowed: false, reason: "Unknown property." };
  const posting = postingsFor(stayId).find((p) => p.id === postingId);
  if (!posting) return { allowed: false, reason: "Posting not found." };
  return canReverse({ reversed: posting.reversed, isReversal: posting.kind === "reversal" });
}

export async function reverseCharge(
  hotelId: string, stayId: string, postingId: string, user: string,
): Promise<OperationResult<Posting>> {
  const permitted = await reverseChargeAllowed(hotelId, stayId, postingId);
  if (!permitted.allowed) return refuse(permitted.reason!);
  const reversal = reversePosting(postingId, user);
  if (!reversal) return refuse("Could not reverse that posting.");
  return { ok: true, data: reversal };
}

/* ── C · Departure → settle → check out ───────────────────────────── */

export async function settle(
  hotelId: string,
  stayId: string,
  input: { method: PaymentMethod; amount: number; businessDate: string; user: string },
): Promise<OperationResult<Posting>> {
  const stay = stayById(hotelId, stayId);
  if (!stay) return refuse("Reservation not found.");
  if (input.amount <= 0) return refuse("A payment must be greater than zero.");

  const posting = addPosting({
    folioId: stayId,
    businessDate: input.businessDate,
    category: "Payment",
    description: input.method === "Bill to company"
      ? "Transferred to city ledger"
      : `Received — ${input.method}`,
    amount: -input.amount,
    tax: 0,
    kind: "payment",
    method: input.method,
    user: input.user,
  });
  return { ok: true, data: posting };
}

export async function checkOutAllowed(hotelId: string, stayId: string): Promise<Permitted> {
  const stay = stayById(hotelId, stayId);
  if (!stay) return { allowed: false, reason: "Reservation not found." };
  return canCheckOut(stay, balanceOf(stayId), money);
}

export async function checkOut(
  hotelId: string, stayId: string, user: string,
): Promise<OperationResult<Stay>> {
  const permitted = await checkOutAllowed(hotelId, stayId);
  if (!permitted.allowed) return refuse(permitted.reason!);

  const stay = stayById(hotelId, stayId)!;
  const updated = mutateStay(stayId, { status: "checked-out" });
  if (!updated) return refuse("Could not close the stay.");

  /* The room the guest just left is dirty, and appears on housekeeping's
     board the moment they walk out. */
  setRoomHousekeeping(stay.roomNumber, "dirty");
  void user;
  return { ok: true, data: updated };
}

/* ── D · Walk-in ──────────────────────────────────────────────────── */

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
  if (!guard(hotelId)) return refuse("Unknown property.");

  const permitted = canConfirmWalkIn(input);
  if (!permitted.allowed) return refuse(permitted.reason!);

  const room = readRooms().find((r) => r.number === input.roomNumber);
  if (!room) return refuse("That room is not part of this property.");

  const occupied = readStays().some(
    (s) =>
      s.roomNumber === input.roomNumber && s.status !== "cancelled" && !s.isDayUse &&
      s.arrival <= input.businessDate && s.departure > input.businessDate,
  );
  const assignable = canAssignRoom({ housekeeping: room.housekeeping, occupied });
  if (!assignable.allowed) return refuse(assignable.reason!);

  const stay: Stay = {
    id: newStayId(),
    hotelId,
    reference: nextReference(),
    guest: input.guestName.trim(),
    roomNumber: input.roomNumber,
    roomType: room.type,
    source: "Walk-in",
    ratePlan: input.ratePlan,
    arrival: input.businessDate,
    departure: addDaysIso(input.businessDate, input.nights),
    nights: input.nights,
    adults: input.adults,
    children: input.children,
    /* A walk-in is one act, not a booking followed by a check-in. */
    status: "in-house",
    isDayUse: false,
    isComplimentary: false,
    rackTariff: input.rackTariff,
    offeredTariff: input.offeredTariff,
    notes: input.overrideReason.trim()
      ? `Rate override — ${input.overrideReason.trim()}`
      : undefined,
  };

  addStay(stay);
  addPosting({
    folioId: stay.id,
    businessDate: input.businessDate,
    category: "Room posting",
    description: `Room ${stay.roomNumber} · ${input.nights} night${input.nights === 1 ? "" : "s"}`,
    amount: input.offeredTariff * input.nights,
    tax: taxOn(input.offeredTariff * input.nights),
    kind: "charge",
    user: input.user,
  });
  setRoomHousekeeping(input.roomNumber, "occupied");

  return { ok: true, data: stay };
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
  hotelId: string, businessDate: string,
): Promise<HousekeepingRoom[]> {
  if (!guard(hotelId)) return [];
  const live = readStays().filter((s) => s.hotelId === hotelId && s.status !== "cancelled");

  return readRooms().map((room) => {
    const inRoom = live.find(
      (s) => s.roomNumber === room.number && !s.isDayUse &&
        s.arrival <= businessDate && s.departure > businessDate,
    );
    const leaving = live.find(
      (s) => s.roomNumber === room.number && s.departure === businessDate,
    );
    return {
      number: room.number,
      type: room.type,
      floor: room.floor,
      housekeeping: room.housekeeping,
      occupied: !!inRoom,
      guest: inRoom?.guest ?? leaving?.guest,
      dueOut: !!leaving,
    };
  });
}

export async function markRoom(
  hotelId: string, roomNumber: string, state: "clean" | "inspected",
): Promise<OperationResult<HousekeepingRoom>> {
  if (!guard(hotelId)) return refuse("Unknown property.");
  const room = readRooms().find((r) => r.number === roomNumber);
  if (!room) return refuse("Room not found.");

  const permitted = state === "clean" ? canMarkClean(room) : canMarkInspected(room);
  if (!permitted.allowed) return refuse(permitted.reason!);

  setRoomHousekeeping(roomNumber, state);
  return { ok: true };
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
