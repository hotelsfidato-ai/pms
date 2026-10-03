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

/* "tentative" since Phase 1 (27 September): a booking held for the hotel
   to confirm, which the desk reads as "Waiting for the hotel" (D27-63). */
export type StayStatus =
  | "due-in" | "in-house" | "due-out" | "checked-out" | "no-show" | "cancelled"
  | "tentative";

/* ⚠ WAS A CLOSED UNION OF SIX NAMES, and stopped being one the moment
   a manager could add a source. It listed Walk-in, Fidato Hotels,
   Agoda, Booking.com, Expedia and go-MMT — the six the demo happened
   to contain — so the first travel agent anybody added would not have
   typechecked as a source.

   Null is a real answer: a booking taken before 082, or one whose
   origin nothing on the record knows. The screen shows a dash. It does
   NOT show "Walk-in", which is what stays.ts guessed for four months —
   defect 219. */
export type Source = string;

export interface Stay {
  id: string;
  hotelId: string;
  reference: string;
  guest: string;
  roomNumber: string;
  roomType: string;
  source: Source | null;
  ratePlan: string;
  arrival: string;          // ISO date
  departure: string;        // ISO date — equal to arrival for day-use
  nights: number;           // 0 for day-use
  adults: number;
  children: number;
  status: StayStatus;
  isDayUse: boolean;
  isComplimentary: boolean;
  /** Per night, before discount. NULL when the room type has no rate
      set — shown as a dash, never ₹0 (defect 246). */
  rackTariff: number | null;
  offeredTariff: number;    // per night, after discount
  groupId?: string;
  /** The booking this room belongs to, when it is one of several sold
      together. Absent for an ordinary single-room stay — a wedding is
      one conversation and nine rooms, and a panel that does not say so
      makes the clerk hold the relationship in their head. */
  group?: { id: string; name: string; rooms: number };
  notes?: string;
  /* ── Marks a clerk acts on ───────────────────────────────────────
     VIP travels with the GUEST — somebody who is one this visit was
     one last visit. The single-lady flag sits on the RESERVATION: the
     same person travelling with family is a different allocation, and
     it drives room placement away from stairwells and service
     corridors. It is not announced at the desk. */
  isVip: boolean;
  /** The group's VIP level, when one was given (193). */
  vipLevel?: string | null;
  /** VIP travels with the GUEST, so setting it needs the guest's id
      rather than the booking's. */
  guestId?: string;
  isSingleLady: boolean;

  /* ── Where the booking came from ─────────────────────────────────
     Null stays null. An unknown segment renders as a dash, never as
     "Direct" or "Other" — a guess here becomes a line in a source-mix
     report somebody sets policy from. */
  businessSource: string | null;
  marketSegment: string | null;
  salesPerson: string | null;

  /** Present only on a voided booking. */
  voidReason?: string;

  /** How to reach the guest. NULL when they gave nothing — most walk-ins —
      and never a placeholder somebody might dial. Optional because a stay
      read by something older than the header that shows them has none. */
  phone?: string | null;
  email?: string | null;
  /** NOT NULL in the database with a default of 'IN', so it is on every
      guest — the panel shows it only when it is not 'IN'. */
  nationality?: string;
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
  /** A group's master bill (D27-226): no stay, the group named. Its nights
      are the company's and are never in a guest's own figures. */
  groupId?: string;
  group?: string | null;
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
  /** Who made the line, by name; null where nobody was recorded. */
  user: string | null;
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
  /** Null where nobody has set it (D22-9) - never 0. */
  tax: { cgst: number | null; sgst: number | null };
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
