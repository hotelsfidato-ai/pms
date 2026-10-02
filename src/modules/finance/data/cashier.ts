import { api, ApiError } from "@/lib/api";
/* The front desk's cash drawer.

   Service: finance. Moved out of operations.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK SHIFT

   Named "drawer" rather than "shift" because `reportData.ts` already
   has a `CashierShift` and they are different questions. That one is
   a REPORT — what each cashier took, looked at afterwards. This is
   the drawer somebody is holding right now.

   Open with a float, take receipts, count the drawer, hand over to
   whoever is on next. The POS day end's shape deliberately — a front
   office that reasons about its cash differently from its restaurant
   is one where the two get compared and nobody can.
   ══════════════════════════════════════════════════════════════════ */

export interface CashierReceipt {
  method: string;
  count: number;
  amount: number;
}

export interface CashierMovement {
  id: string;
  kind: string;
  amount: number;
  reason: string;
  recordedBy: string;
  at: string;
  /** A paid-out's yes (D27-242): pending, clarify, approved, rejected;
      null where nobody was asked. Optional to the reader (MEMORY 360). */
  approval?: string | null;
  approvalNote?: string | null;
}

export interface CashierDrawer {
  id: string;
  openedAt: string;
  opening: number;
  /** The kept floats this drawer took up, and from whose close (D27-202). */
  received?: { amount: number; from: string | null; closedAt: string }[];
  receipts: CashierReceipt[];
  movements: CashierMovement[];
  /** Opening float plus CASH receipts taken by this cashier during this
      shift, plus money in, less money out. A card receipt never touched
      the drawer. */
  expected: number;
  /** Null until somebody counts. Not zero — nobody counted zero. */
  counted: number | null;
  variance: number | null;
  /** Paid-outs waiting for a yes, not in `expected` yet (D27-242). */
  waiting?: number;
  varianceReason: string | null;
  denominations: { value: number; count: number }[];
}

export interface CashierDrawerView {
  businessDate: string;
  /** Null when no drawer is open. That is a real state, not an error:
      the shift has not started. */
  shift: CashierDrawer | null;
  /** With no drawer open: the float handed to this person by name, which
      their drawer opens on when they first take cash (D27-201). 0 for
      anyone else. */
  waiting?: number;
  /** Who the drawer can be handed to. Nobody is a real answer — the
      last close of the night hands over to no one. */
  colleagues: { id: string; name: string }[];
  /** The person's last close: what was counted, the float kept and for
      whom - so the rest, what went to deposit (D27-202). `kept` is null on
      a close from before the float was recorded. */
  previous: { closedAt: string; counted: number; kept?: number | null; handedTo: string | null } | null;
}

export async function getCashierDrawer(
  hotelId: string,
): Promise<CashierDrawerView | null> {
  if (!hotelId) return null;
  try {
    return await api<CashierDrawerView>(
      `/api/hotels/${hotelId}/cashier-shift`);
  } catch {
    return null;
  }
}

type ShiftResult = { ok: true } | { ok: false; reason: string };

export async function openCashierShift(
  hotelId: string, opening: number,
): Promise<ShiftResult> {
  return shiftCall(hotelId, "open", { opening });
}

export async function recordCashierMovement(
  hotelId: string,
  input: { kind: "expense" | "top_up" | "withdrawal"; amount: number; reason: string },
): Promise<ShiftResult> {
  return shiftCall(hotelId, "movements", input);
}

/** The count replaces whatever was there. Somebody empties the drawer
    and counts it; merging a new count into an old one leaves
    denominations nobody typed this time. */
export async function countCashierDrawer(
  hotelId: string, denominations: { value: number; count: number }[],
): Promise<ShiftResult> {
  return shiftCall(hotelId, "count", { denominations });
}

/**
 * Closes the shift and hands the drawer over.
 *
 * A difference does not stop the close — the money is already whatever
 * it is, and a desk that cannot hand over is worse than a difference
 * written down. It does have to say why.
 */
export async function closeCashierShift(
  hotelId: string,
  input: { varianceReason?: string; handOverTo?: string | null; keptCash: number },
): Promise<ShiftResult> {
  return shiftCall(hotelId, "close", input);
}

async function shiftCall(
  hotelId: string, path: string, body: unknown,
): Promise<ShiftResult> {
  try {
    await api(`/api/hotels/${hotelId}/cashier-shift/${path}`, {
      method: "POST", body: JSON.stringify(body),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
