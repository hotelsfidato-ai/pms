/* ══════════════════════════════════════════════════════════════════
   Stay, Folio, and what they are allowed to be

   Copied VERBATIM out of `src/data/fixtures/reservations.ts`, which is
   test data. Until now `types.ts` re-exported them from there:

       export type { Stay, Folio, StayStatus, Source }
         from "../fixtures/reservations";

   One `export type` was enough to keep the whole module alive through
   the bundler, so 26 KB of invented bookings — twenty guest names, a
   fifteen-row reservation table, and the RACK prices that caused
   defects 63 and 65 — shipped inside the bundle a real hotel loads.

   This is the SECOND time. The comment below on `Posting` describes
   the same thing happening to `src/data/store.ts`: "this type was the
   last thing importing it, and the file was 1,331 lines of fixture
   kept alive by a single import type". The remedy was the same then.

   A type that production depends on does not live in a fixture.
   ══════════════════════════════════════════════════════════════════ */

export type StayStatus =
  | "due-in" | "in-house" | "due-out" | "checked-out" | "no-show" | "cancelled";

export type Source =
  | "Walk-in" | "Fidato Hotels" | "Agoda" | "Booking.com" | "Expedia" | "go-MMT";

export interface Stay {
  id: string;
  hotelId: string;
  reference: string;
  guest: string;
  roomNumber: string;
  roomType: string;
  source: Source;
  ratePlan: string;
  arrival: string;          // ISO date
  departure: string;        // ISO date — equal to arrival for day-use
  nights: number;           // 0 for day-use
  adults: number;
  children: number;
  status: StayStatus;
  isDayUse: boolean;
  isComplimentary: boolean;
  rackTariff: number;       // per night, before discount
  offeredTariff: number;    // per night, after discount
  groupId?: string;
  notes?: string;
}

export interface Folio {
  stayId: string;
  roomCharges: number;
  extraCharges: number;
  tax: number;
  discount: number;
  payments: number;
  /** charges + tax − discount − payments. Negative means the guest overpaid. */
  balance: number;
  status: "open" | "settled" | "disputed" | "written-off";
}

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
  /** The folio this line sits on. A stay may have two — a company
      paying the room while the guest pays their own bar tab. */
  folioId: string;
  stayId: string;
  billTo: string;
  /** Null on a guest folio, never a missing name. */
  company: string | null;
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
  /* Without this nothing could ever LIFT a block. The projection
     returned a reason and two dates, so the interface could draw a
     room as out of order and offer no way back. */
  id: string;
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
