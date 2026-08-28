import { stays as seedStays, folios as seedFolios, type Stay } from "./fixtures/reservations";
import { roomInventory } from "./fixtures/property";

/* ══════════════════════════════════════════════════════════════════
   THE MUTABLE STORE

   Stage 1 has no backend, but the five flows have to actually change
   something — a check-in that does not visibly move the arrivals count
   has not been demonstrated.

   So the fixtures seed an in-memory store, and the repositories read
   and write it. Nothing here is exported past `src/data`: screens
   still see only the repositories, and when the real database arrives
   this file is what disappears.

   The folio is an APPEND-ONLY LEDGER. A wrong posting is reversed with
   its own line; nothing is edited and nothing is deleted. That is how
   the database behaves and the interface should not learn a habit it
   will have to unlearn.
   ══════════════════════════════════════════════════════════════════ */

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

export interface StoreRoom {
  number: string;
  type: string;
  floor: number;
  housekeeping: string;
  maxOccupancy: number;
}

interface Store {
  stays: Stay[];
  postings: Posting[];
  rooms: StoreRoom[];
  version: number;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** Seeds the ledger from the fixture folios, as opening lines. */
function seedPostings(): Posting[] {
  const out: Posting[] = [];
  for (const f of seedFolios) {
    const stay = seedStays.find((s) => s.id === f.stayId);
    if (!stay) continue;
    const at = `${stay.arrival}T12:00:00Z`;

    if (f.roomCharges > 0) {
      out.push({
        id: nextId("post"), folioId: f.stayId, businessDate: stay.arrival,
        category: "Room posting",
        description: `Room ${stay.roomNumber} · ${stay.nights || 1} night${(stay.nights || 1) === 1 ? "" : "s"}`,
        amount: f.roomCharges, tax: f.tax, kind: "charge", reversed: false,
        createdAt: at, user: "admin",
      });
    }
    if (f.extraCharges > 0) {
      out.push({
        id: nextId("post"), folioId: f.stayId, businessDate: stay.arrival,
        category: "Miscellaneous", description: "Extras",
        amount: f.extraCharges, tax: 0, kind: "charge", reversed: false,
        createdAt: at, user: "admin",
      });
    }
    if (f.discount > 0) {
      out.push({
        id: nextId("post"), folioId: f.stayId, businessDate: stay.arrival,
        category: "Miscellaneous", description: "Discount",
        amount: -f.discount, tax: 0, kind: "charge", reversed: false,
        createdAt: at, user: "admin",
      });
    }
    if (f.payments > 0) {
      out.push({
        id: nextId("post"), folioId: f.stayId, businessDate: stay.departure,
        category: "Payment", description: "Settlement",
        amount: -f.payments, tax: 0, kind: "payment", method: "Cash",
        reversed: false, createdAt: `${stay.departure}T11:00:00Z`, user: "admin",
      });
    }
  }
  return out;
}

const store: Store = {
  stays: seedStays.map((s) => ({ ...s })),
  postings: seedPostings(),
  /* The fixture calls it `status`; the store calls it `housekeeping`,
     because occupancy and cleanliness are independent and the name
     should not suggest otherwise. */
  rooms: roomInventory.map((r) => ({
    number: r.number,
    type: r.type,
    floor: r.floor,
    housekeeping: r.status,
    maxOccupancy: r.maxOccupancy,
  })),
  version: 0,
};

/** Bumped on every write so callers know to refetch. */
export const bump = () => ++store.version;
export const getVersion = () => store.version;

export const readStays = () => store.stays;
export const readPostings = () => store.postings;
export const readRooms = () => store.rooms;

/* ── Balance, derived from the ledger and never stored ────────────── */

export function balanceOf(folioId: string): number {
  const live = store.postings.filter((p) => p.folioId === folioId && !p.reversed);
  const total = live.reduce((t, p) => t + p.amount + p.tax, 0);
  return Math.round(total * 100) / 100;
}

export function postingsFor(folioId: string): Posting[] {
  return store.postings
    .filter((p) => p.folioId === folioId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/* ── Writes ───────────────────────────────────────────────────────── */

export function mutateStay(id: string, patch: Partial<Stay>): Stay | null {
  const i = store.stays.findIndex((s) => s.id === id);
  if (i === -1) return null;
  store.stays[i] = { ...store.stays[i]!, ...patch };
  bump();
  return store.stays[i]!;
}

export function addStay(stay: Stay): Stay {
  store.stays.push(stay);
  bump();
  return stay;
}

export function addPosting(p: Omit<Posting, "id" | "reversed" | "createdAt">): Posting {
  const posting: Posting = {
    ...p,
    id: nextId("post"),
    reversed: false,
    createdAt: new Date().toISOString(),
  };
  store.postings.push(posting);
  bump();
  return posting;
}

/**
 * Reverses a posting by appending its mirror image. The original is
 * marked reversed but stays on the folio — a clerk must be able to see
 * that it happened and was undone.
 */
export function reversePosting(id: string, user: string): Posting | null {
  const original = store.postings.find((p) => p.id === id);
  if (!original || original.reversed || original.kind === "reversal") return null;

  original.reversed = true;
  const reversal: Posting = {
    id: nextId("post"),
    folioId: original.folioId,
    businessDate: original.businessDate,
    category: original.category,
    description: `Reversal — ${original.description}`,
    amount: -original.amount,
    tax: -original.tax,
    kind: "reversal",
    reversalOf: original.id,
    reversed: false,
    createdAt: new Date().toISOString(),
    user,
  };
  store.postings.push(reversal);
  bump();
  return reversal;
}

export function setRoomHousekeeping(number: string, state: string): StoreRoom | null {
  const room = store.rooms.find((r) => r.number === number);
  if (!room) return null;
  room.housekeeping = state;
  bump();
  return room;
}

export function nextReference(): string {
  return `FH-2608-${String(6000 + store.stays.length).padStart(4, "0")}`;
}

export function newStayId(): string {
  return nextId("stay");
}
