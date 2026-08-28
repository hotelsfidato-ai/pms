import { groups } from "../fixtures/reservations";
import { readStays, balanceOf, postingsFor } from "../store";
import type { Stay, Folio } from "./types";

/* ══════════════════════════════════════════════════════════════════
   STAYS AND FOLIOS

   Every query takes `hotelId` first, and filters on it before doing
   anything else. That is not ceremony while there is one property —
   it is the shape the database already enforces with RLS, and the
   reason adding six more properties is a data change, not a rewrite.
   ══════════════════════════════════════════════════════════════════ */

/** The business date the demo is pinned to — the Night Audit's "As On Date". */
export const BUSINESS_DATE = "2026-08-25";

const forHotel = (hotelId: string) => readStays().filter((s) => s.hotelId === hotelId);
const clone = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r }));
const round = (n: number) => Math.round(n * 100) / 100;

export interface StayFilter {
  status?: Stay["status"][];
  source?: Stay["source"][];
  roomNumber?: string;
  /** Matches guest name, reference or room number, case-insensitively. */
  search?: string;
  /** Stays overlapping this range. */
  from?: string;
  to?: string;
}

export async function listStays(
  hotelId: string,
  filter: StayFilter = {},
): Promise<Stay[]> {
  let rows = forHotel(hotelId);

  if (filter.status?.length) rows = rows.filter((s) => filter.status!.includes(s.status));
  if (filter.source?.length) rows = rows.filter((s) => filter.source!.includes(s.source));
  if (filter.roomNumber) rows = rows.filter((s) => s.roomNumber === filter.roomNumber);

  if (filter.from) rows = rows.filter((s) => s.departure >= filter.from!);
  if (filter.to) rows = rows.filter((s) => s.arrival <= filter.to!);

  if (filter.search) {
    const q = filter.search.trim().toLowerCase();
    rows = rows.filter(
      (s) =>
        s.guest.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.roomNumber.includes(q),
    );
  }

  return clone(rows).sort((a, b) => a.arrival.localeCompare(b.arrival));
}

export async function getStay(hotelId: string, id: string): Promise<Stay | null> {
  return forHotel(hotelId).find((s) => s.id === id) ?? null;
}

/* ── The front desk's three working lists ──────────────────────────
   Named for what a clerk is doing, not for a status value.        ═══ */

export async function listArrivals(hotelId: string, date = BUSINESS_DATE) {
  const rows = forHotel(hotelId).filter(
    (s) => s.arrival === date && s.status !== "cancelled",
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

export async function listInHouse(hotelId: string, date = BUSINESS_DATE) {
  const rows = forHotel(hotelId).filter(
    (s) =>
      s.status !== "cancelled" &&
      !s.isDayUse &&
      s.arrival <= date &&
      s.departure > date,
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

export async function listDepartures(hotelId: string, date = BUSINESS_DATE) {
  const rows = forHotel(hotelId).filter(
    (s) => s.departure === date && s.status !== "cancelled",
  );
  return clone(rows).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
}

/** Rooms with nobody in them tonight — what a walk-in can be given. */
export async function listVacant(hotelId: string, date = BUSINESS_DATE) {
  const taken = new Set((await listInHouse(hotelId, date)).map((s) => s.roomNumber));
  const arriving = new Set((await listArrivals(hotelId, date)).map((s) => s.roomNumber));
  return { taken, arriving };
}

/* ── Folios ───────────────────────────────────────────────────────── */

export async function getFolio(hotelId: string, stayId: string): Promise<Folio | null> {
  const stay = await getStay(hotelId, stayId);
  if (!stay) return null;

  /* Derived from the ledger, never stored — see src/data/store.ts. */
  const lines = postingsFor(stayId).filter((p) => !p.reversed);
  const charges = lines.filter((p) => p.kind !== "payment");
  const payments = lines.filter((p) => p.kind === "payment");
  const balance = balanceOf(stayId);

  return {
    stayId,
    roomCharges: round(charges.filter((p) => p.amount > 0).reduce((t, p) => t + p.amount, 0)),
    extraCharges: 0,
    tax: round(charges.reduce((t, p) => t + p.tax, 0)),
    discount: round(-charges.filter((p) => p.amount < 0).reduce((t, p) => t + p.amount, 0)),
    payments: round(-payments.reduce((t, p) => t + p.amount, 0)),
    balance,
    status: balance === 0 ? "settled" : "open",
  };
}

/** Folios still carrying a balance — includes overpayments, which are negative. */
export async function listOpenFolios(hotelId: string): Promise<Array<Folio & { stay: Stay }>> {
  const out: Array<Folio & { stay: Stay }> = [];
  for (const stay of forHotel(hotelId)) {
    const folio = await getFolio(hotelId, stay.id);
    if (folio && folio.balance !== 0) out.push({ ...folio, stay });
  }
  return out.sort((a, b) => a.balance - b.balance);
}

/* ── Groups ───────────────────────────────────────────────────────── */

export async function listGroups(hotelId: string) {
  return groups.filter((g) => g.hotelId === hotelId).map((g) => ({ ...g }));
}

export async function listGroupMembers(hotelId: string, groupId: string): Promise<Stay[]> {
  return clone(forHotel(hotelId).filter((s) => s.groupId === groupId));
}

/* ══════════════════════════════════════════════════════════════════
   OBJECT SURFACE

   The same functions, exposed as `staysRepo`, because callers in this
   project use both conventions. One implementation, two surfaces, so
   neither style of import can fail — and there is no second copy of
   the logic to drift.
   ══════════════════════════════════════════════════════════════════ */

export const staysRepo = {
  list: listStays,
  get: getStay,
  listArrivals,
  listInHouse,
  listDepartures,
  listVacant,
  getFolio,
  listOpenFolios,
  listGroups,
  listGroupMembers,
  BUSINESS_DATE,

  /** Composite helpers some callers expect. */
  async checkIn(hotelId: string, stayId: string, roomNumber?: string) {
    const { checkIn } = await import("./operations");
    return checkIn(hotelId, stayId, {
      roomNumber: roomNumber ?? "",
      adults: 1, children: 0, ratePlan: "CP",
      idCaptured: true, businessDate: BUSINESS_DATE, user: "front desk",
    });
  },
  async checkOut(hotelId: string, stayId: string) {
    const { checkOut } = await import("./operations");
    return checkOut(hotelId, stayId, "front desk");
  },
};

export const stayRepo = staysRepo;
