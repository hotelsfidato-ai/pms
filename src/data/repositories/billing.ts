import { readStays, readPostings, readRooms, balanceOf } from "../store";
import { property, isDemoProperty } from "../fixtures/property";
import { BUSINESS_DATE } from "./stays";
import type { Stay } from "./types";

/* ══════════════════════════════════════════════════════════════════
   BILLING — payments, billable folios, rates, and the night audit

   Two things here are deliberately NOT done.

   No invoice number is issued. The series in the property fixture is
   a real GST series — 5EFH154 is the next one the hotel will actually
   print — and a number that appears on screen but never on a filed
   return leaves a hole in a statutory sequence. So departed stays are
   listed as billable and the series is shown as it stands.

   The night audit does not run. It posts room charges and rolls the
   business date, and the business date is a constant in Stage 1.
   Everything the audit would check is computed anyway, because the
   checklist is the part a manager actually reads.
   ══════════════════════════════════════════════════════════════════ */

const guard = isDemoProperty;
const round = (n: number) => Math.round(n * 100) / 100;

/* ── Payments ────────────────────────────────────────────────────── */

export interface PaymentRow {
  id: string;
  businessDate: string;
  at: string;
  guest: string;
  roomNumber: string;
  reference: string;
  method: string;
  description: string;
  amount: number;
  user: string;
  reversed: boolean;
}

export interface PaymentsByMethod {
  method: string;
  count: number;
  amount: number;
}

/**
 * A payment is a negative posting. Reversed payments stay in the list
 * struck through rather than vanishing, because the ledger is
 * append-only and a receipt that disappears is a receipt somebody
 * will go looking for.
 */
export async function listPayments(hotelId: string): Promise<PaymentRow[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays();
  const byId = new Map(stays.map((s) => [s.id, s]));

  return readPostings()
    .filter((p) => p.kind === "payment" && byId.has(p.folioId))
    .map((p) => {
      const stay = byId.get(p.folioId)!;
      return {
        id: p.id,
        businessDate: p.businessDate,
        at: p.createdAt,
        guest: stay.guest,
        roomNumber: stay.roomNumber,
        reference: stay.reference,
        method: p.method ?? "Unrecorded",
        description: p.description,
        amount: round(-p.amount),
        user: p.user,
        reversed: p.reversed,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Live receipts by method — reversed lines excluded, as they must be. */
export async function paymentsByMethod(hotelId: string): Promise<PaymentsByMethod[]> {
  const rows = (await listPayments(hotelId)).filter((r) => !r.reversed);
  const map = new Map<string, PaymentsByMethod>();

  for (const r of rows) {
    const entry = map.get(r.method) ?? { method: r.method, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = round(entry.amount + r.amount);
    map.set(r.method, entry);
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/* ── Billable folios ─────────────────────────────────────────────── */

export interface BillableRow {
  stayId: string;
  reference: string;
  guest: string;
  roomNumber: string;
  roomType: string;
  source: string;
  arrival: string;
  departure: string;
  nights: number;
  charges: number;
  tax: number;
  paid: number;
  balance: number;
  /** Only a settled folio can be invoiced. */
  status: "settled" | "outstanding" | "overpaid";
}

export async function listBillable(hotelId: string): Promise<BillableRow[]> {
  if (!guard(hotelId)) return [];

  const postings = readPostings().filter((p) => !p.reversed);

  return readStays()
    .filter((s) => s.status === "checked-out")
    .map((s) => {
      const lines = postings.filter((p) => p.folioId === s.id);
      const charges = round(
        lines.filter((p) => p.kind !== "payment").reduce((t, p) => t + p.amount, 0),
      );
      const tax = round(
        lines.filter((p) => p.kind !== "payment").reduce((t, p) => t + p.tax, 0),
      );
      const paid = round(
        lines.filter((p) => p.kind === "payment").reduce((t, p) => t + -p.amount, 0),
      );
      const balance = round(balanceOf(s.id));

      return {
        stayId: s.id,
        reference: s.reference,
        guest: s.guest,
        roomNumber: s.roomNumber,
        roomType: s.roomType,
        source: s.source,
        arrival: s.arrival,
        departure: s.departure,
        nights: s.nights,
        charges,
        tax,
        paid,
        balance,
        status:
          balance > 0.5 ? "outstanding" as const
            : balance < -0.5 ? "overpaid" as const
            : "settled" as const,
      };
    })
    .sort((a, b) => b.departure.localeCompare(a.departure));
}

export interface InvoiceSeriesState {
  prefix: string;
  next: string;
  note: string;
}

/** What the next invoice number WOULD be. Nothing consumes it yet. */
export async function getInvoiceSeries(hotelId: string): Promise<InvoiceSeriesState[]> {
  if (!guard(hotelId)) return [];
  return property.invoiceSeries.map((s) => ({
    prefix: s.prefix || "Numeric",
    next: s.prefix ? `${s.prefix}${s.next}` : String(s.next).padStart(s.pad ?? 6, "0"),
    note: s.prefix
      ? "The GST series the hotel prints today."
      : "The internal series, zero-padded.",
  }));
}

/* ── Rates ───────────────────────────────────────────────────────── */

export interface RateCell {
  date: string;
  rackRate: number;
  /** What rooms of this type actually sold for on the date. */
  soldAdr: number | null;
  sold: number;
  sellable: number;
}

export interface RateRow {
  roomType: string;
  rackRate: number;
  cells: RateCell[];
}

const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };

function addDaysLocal(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The grid a revenue manager reads: rack against what was achieved.
 * There is no published rate calendar in this system yet, so rack is
 * flat across the row and every difference in the achieved line comes
 * from what was actually negotiated on the day.
 */
export async function getRateGrid(
  hotelId: string,
  from = BUSINESS_DATE,
  days = 14,
): Promise<RateRow[]> {
  if (!guard(hotelId)) return [];

  const rooms = readRooms();
  const stays = readStays().filter(
    (s) => s.status !== "cancelled" && s.status !== "no-show",
  );
  const types = [...new Set(rooms.map((r) => r.type))];
  const dates = Array.from({ length: days }, (_, i) => addDaysLocal(from, i));

  return types.map((roomType) => {
    const sellable = rooms.filter(
      (r) => r.type === roomType && r.housekeeping !== "out-of-service",
    ).length;

    return {
      roomType,
      rackRate: RACK[roomType] ?? 0,
      cells: dates.map((date) => {
        const onDate = stays.filter(
          (s) => s.roomType === roomType && s.arrival <= date && s.departure > date,
        );
        const paying = onDate.filter((s) => !s.isComplimentary);
        return {
          date,
          rackRate: RACK[roomType] ?? 0,
          soldAdr: paying.length
            ? round(paying.reduce((t, s) => t + s.offeredTariff, 0) / paying.length)
            : null,
          /* Paying rooms, not occupied ones. A complimentary room is
             occupied and sold for nothing, and counting it here would
             disagree with the rate beside it and with the Sold Room
             line on the Manager Report. */
          sold: paying.length,
          sellable,
        };
      }),
    };
  });
}

/* ── Night audit ─────────────────────────────────────────────────── */

export interface AuditCheck {
  id: string;
  label: string;
  detail: string;
  /** ok — nothing to do. attention — a person should look first. */
  state: "ok" | "attention";
  count: number;
  link?: string;
}

export interface NightAuditState {
  businessDate: string;
  nextBusinessDate: string;
  checks: AuditCheck[];
  /** Rule 6 — refused, with the reason on screen rather than hidden. */
  canRun: { allowed: boolean; reason?: string };
  lastRun: string | null;
}

export async function getNightAudit(hotelId: string): Promise<NightAuditState | null> {
  if (!guard(hotelId)) return null;

  const stays = readStays();
  const rooms = readRooms();
  const postings = readPostings();

  const outstanding = stays.filter(
    (s) => s.status === "due-in" && s.arrival === BUSINESS_DATE,
  );
  const dueOut = stays.filter((s) => s.status === "due-out");
  const owing = stays
    .filter((s: Stay) => s.status === "in-house" || s.status === "due-out")
    .filter((s) => balanceOf(s.id) > 0.5);
  const toPost = stays.filter(
    (s) => (s.status === "in-house" || s.status === "due-out") && !s.isDayUse,
  );
  const dirty = rooms.filter((r) => r.housekeeping === "dirty");
  const reversals = postings.filter(
    (p) => p.kind === "reversal" && p.businessDate === BUSINESS_DATE,
  );

  const checks: AuditCheck[] = [
    {
      id: "arrivals",
      label: "Arrivals still outstanding",
      detail:
        "An arrival left unchecked at roll-over becomes a no-show, and the retention posts against it.",
      state: outstanding.length ? "attention" : "ok",
      count: outstanding.length,
      link: `/h/${hotelId}/arrivals`,
    },
    {
      id: "departures",
      label: "Departures not yet checked out",
      detail: "A room still showing due out holds its inventory into tomorrow.",
      state: dueOut.length ? "attention" : "ok",
      count: dueOut.length,
      link: `/h/${hotelId}/in-house/due-out`,
    },
    {
      id: "balances",
      label: "In-house folios carrying a balance",
      detail:
        "These roll forward. Nothing is wrong with that — it is worth seeing before it happens.",
      state: owing.length ? "attention" : "ok",
      count: owing.length,
      link: `/h/${hotelId}/folios`,
    },
    {
      id: "room-charges",
      label: "Room charges to post",
      detail:
        "One night's tariff and tax per occupied room. Day-use stays are excluded — they have already been charged.",
      state: "ok",
      count: toPost.length,
    },
    {
      id: "housekeeping",
      label: "Rooms still marked dirty",
      detail:
        "Not a blocker. A room left dirty overnight is a room the morning shift inherits.",
      state: dirty.length ? "attention" : "ok",
      count: dirty.length,
      link: `/h/${hotelId}/housekeeping`,
    },
    {
      id: "reversals",
      label: "Postings reversed today",
      detail:
        "Every reversal is somebody correcting something. Worth reading before the day closes.",
      state: reversals.length ? "attention" : "ok",
      count: reversals.length,
      link: `/h/${hotelId}/admin/audit-log`,
    },
  ];

  return {
    businessDate: BUSINESS_DATE,
    nextBusinessDate: addDaysLocal(BUSINESS_DATE, 1),
    checks,
    canRun: {
      allowed: false,
      reason:
        "The business date is fixed in this stage, so the roll-over has nowhere to go. Posting room charges without advancing the date would double-charge every occupied room the next time it ran.",
    },
    lastRun: null,
  };
}
