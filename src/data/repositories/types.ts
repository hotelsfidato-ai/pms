export type { Stay, Folio, StayStatus, Source } from "../fixtures/reservations";

/**
 * One line of the append-only ledger.
 *
 * Copied verbatim from `src/data/store.ts` — the in-memory
 * implementation every repository read before CP9 moved them onto
 * Postgres. By the end the store held no data anything read; this type
 * was the last thing importing it, and the file was 1,331 lines of
 * fixture kept alive by a single `import type`.
 *
 * Verbatim matters: the first attempt at moving it wrote a plausible
 * shape from memory — `date`, `reversesId` — instead of the real one.
 * A type that is nearly right compiles and then disagrees with the
 * data at runtime.
 */
export interface Posting {
  id: string;
  folioId: string;               // the stay it belongs to
  businessDate: string;
  category: string;
  description: string;
  /** Positive is money owed by the guest; negative is money received. */
  amount: number;
  tax: number;
  kind: "charge" | "payment" | "reversal";
  /** Set on a reversal, naming the posting it undoes. */
  reversalOf?: string;
  /** Set on the original once it has been reversed. */
  reversed: boolean;
  method?: string;               // payments only
  createdAt: string;
  user: string;
}

/* ══════════════════════════════════════════════════════════════════
   The shapes screens are allowed to know about.

   Screens import from `@/data/repositories` and never from
   `@/data/fixtures`. When this project moves onto the real database,
   the fixtures folder disappears and these signatures do not.
   ══════════════════════════════════════════════════════════════════ */

export interface RoomBlock {
  from: string;
  /** Null means open-ended — the room is out until somebody says otherwise. */
  to: string | null;
  reason: string | null;
}

export interface Room {
  number: string;
  type: string;
  floor: number;
  /** Independent of occupancy — a room can be occupied and dirty. */
  status: string;
  maxOccupancy: number;
  /** The room type's rack rate, as the hotel set it.
   *
   *  NULL when nobody has set one — a real state since 032, which
   *  stopped the templates shipping invented prices. The interface
   *  shows a dash and asks for a tariff rather than filling one in. */
  rackRate: number | null;
  /**
   * The date ranges this room is out of inventory.
   *
   * `status` says whether a room is out TODAY. It cannot say a room was
   * back in inventory for six days in August, which is what the real
   * export shows and what the tape chart has to draw — and which the
   * frontend answered from a hardcoded list of six dates until
   * migration 022 modelled room_blocks.
   */
  blocks: RoomBlock[];
}

export interface Property {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  rooms: number;
  roomTypes: string[];
  rateTypes: string[];
  tax: { cgst: number; sgst: number };
  paymentMethods: string[];
}

export interface DayStatistics {
  date: string;
  availableRooms: number;
  roomsSold: number;
  occupancyPct: number;
}

export interface PeriodStatistics {
  from: string;
  to: string;
  availableRoomNights: number;
  roomsSold: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  roomRevenue: number;
}

/** Rule 6 — a blocked action is shown disabled with a reason, never hidden. */
export interface Permitted {
  allowed: boolean;
  reason?: string;
}
