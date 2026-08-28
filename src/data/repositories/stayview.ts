import { listAllRooms } from "./rooms";
import { listStays, listOpenFolios } from "./stays";
import { EXTRA_ROOM_DATES } from "../fixtures/property";
import type { Stay } from "./types";

/* ══════════════════════════════════════════════════════════════════
   STAY VIEW — the tape chart's data

   Fourteen days across seventeen rooms, on one screen, with no
   horizontal scroll. Everything here is shaped for that: the chart
   asks for a window and gets back exactly what it draws.
   ══════════════════════════════════════════════════════════════════ */

export const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };

export type BarTone =
  | "in-house" | "confirmed" | "tentative" | "due-out" | "no-show" | "void";

export interface ChartBar {
  stay: Stay;
  /** 0-based index into the window. */
  startIndex: number;
  /** Number of columns the bar spans — always at least 1. */
  span: number;
  tone: BarTone;
  clippedStart: boolean;
  clippedEnd: boolean;
  balance: number;
}

export interface ChartRoom {
  number: string;
  type: string;
  floor: number;
  housekeeping: string;
  outOfService: boolean;
  bars: ChartBar[];
  /** State on the business date. The filter pills read these, and so do
      their counts, so a pill can never disagree with what it filters to. */
  state: {
    occupied: boolean;
    /** Expected today and not yet checked in. */
    arriving: boolean;
    reserved: boolean;
    dueOut: boolean;
    dirty: boolean;
  };
}

export interface ChartRoomType {
  type: string;
  rooms: ChartRoom[];
  perDate: Array<{ date: string; available: number; rate: number }>;
}

export interface ChartFooter {
  date: string;
  availableInventory: number;
  occupancyPct: number;
}

export interface StayViewData {
  dates: string[];
  roomTypes: ChartRoomType[];
  footer: ChartFooter[];
  counts: Record<string, number>;
}

/* ── Dates ────────────────────────────────────────────────────────── */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function windowFrom(start: string, length = 14): string[] {
  return Array.from({ length }, (_, i) => addDays(start, i));
}

/** Saturday or Sunday — the live system marks both. */
export function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/* ── Bars ─────────────────────────────────────────────────────────── */

/**
 * Tone follows STATUS, not dates.
 *
 * An earlier version derived it from dates alone, which meant a guest
 * who had arrived but not been checked in already showed as in-house —
 * so completing a check-in changed nothing on screen. The visible
 * change is what tells a clerk the work landed, so status leads.
 */
function toneFor(stay: Stay, businessDate: string): BarTone {
  if (stay.status === "cancelled") return "void";
  if (stay.status === "no-show") return "no-show";
  if (stay.status === "in-house") {
    /* Still in house, but leaving today — the clerk needs both facts. */
    return stay.departure === businessDate ? "due-out" : "in-house";
  }
  if (stay.status === "due-out") return "due-out";
  if (stay.status === "checked-out") return "tentative";
  /* due-in: expected, possibly today, but nobody has arrived yet. */
  return "confirmed";
}

/** A day-use stay occupies its single date; everything else its nights. */
function occupiedDates(stay: Stay): { from: string; to: string } {
  return stay.isDayUse
    ? { from: stay.arrival, to: stay.arrival }
    : { from: stay.arrival, to: addDays(stay.departure, -1) };
}

/* ── The chart ────────────────────────────────────────────────────── */

export async function getStayView(
  hotelId: string,
  start: string,
  businessDate: string,
  length = 14,
): Promise<StayViewData | null> {
  if (!hotelId) return null;

  const dates = windowFrom(start, length);
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;

  /* Fetched ONCE, then everything below is pure computation. Reaching
     for the transport inside the per-room loop would have made this
     eighteen requests, and eighteen chances for the chart to disagree
     with itself halfway down. */
  const [allRooms, allStays, openFolios] = await Promise.all([
    listAllRooms(hotelId),
    listStays(hotelId),
    listOpenFolios(hotelId),
  ]);

  if (allRooms.length === 0) return null;

  /* A folio only appears in `openFolios` when it carries a balance,
     so absent IS zero. Looking each one up separately would have been
     eighty-three more requests to learn the same thing. */
  const balances = new Map(openFolios.map((f) => [f.stayId, f.balance]));
  const balanceOf = (stayId: string) => balances.get(stayId) ?? 0;

  const sellableOn = (roomNumber: string, date: string) => {
    const room = allRooms.find((r) => r.number === roomNumber);
    if (!room) return false;
    return room.status !== "out-of-service" || EXTRA_ROOM_DATES.includes(date);
  };

  const rooms: ChartRoom[] = allRooms.map((room) => {
    const bars: ChartBar[] = allStays
      .filter((s) => s.roomNumber === room.number)
      .map((s) => {
        const { from, to } = occupiedDates(s);
        if (to < first || from > last) return null;
        const rawStart = dates.indexOf(from);
        const rawEnd = dates.indexOf(to);
        const startIndex = rawStart === -1 ? 0 : rawStart;
        const endIndex = rawEnd === -1 ? dates.length - 1 : rawEnd;
        return {
          stay: s,
          startIndex,
          span: Math.max(1, endIndex - startIndex + 1),
          tone: toneFor(s, businessDate),
          clippedStart: from < first,
          clippedEnd: to > last,
          balance: balanceOf(s.id),
        } satisfies ChartBar;
      })
      .filter((b): b is ChartBar => b !== null)
      .sort((a, b) => a.startIndex - b.startIndex);

    const live = allStays.filter(
      (s) => s.roomNumber === room.number && s.status !== "cancelled",
    );

    return {
      number: room.number,
      type: room.type,
      floor: room.floor,
      housekeeping: room.status,
      outOfService: room.status === "out-of-service",
      bars,
      /* All four read STATUS where status is what changes. A room is
         occupied when someone has actually checked in, not merely
         because a booking covers tonight — otherwise a check-in moves
         no number and the clerk cannot see their work land. */
      state: {
        occupied: live.some((s) => s.status === "in-house" || s.status === "due-out"),
        arriving: live.some((s) => s.status === "due-in" && s.arrival === businessDate),
        reserved: live.some((s) => s.status === "due-in" && s.arrival > businessDate),
        dueOut: live.some((s) => s.status === "due-out" || (s.status === "in-house" && s.departure === businessDate)),
        dirty: room.status === "dirty",
      },
    };
  });

  /* Group by room type, in the order the property declares them. */
  const types = [...new Set(allRooms.map((r) => r.type))];
  const roomTypes: ChartRoomType[] = types.map((type) => {
    const ofType = rooms.filter((r) => r.type === type);
    return {
      type,
      rooms: ofType,
      perDate: dates.map((date, i) => {
        const sellable = ofType.filter((r) => sellableOn(r.number, date));
        const taken = sellable.filter((r) =>
          r.bars.some(
            (b) => b.tone !== "void" && b.startIndex <= i && b.startIndex + b.span - 1 >= i,
          ),
        );
        return {
          date,
          available: sellable.length - taken.length,
          /* Rack rate. A published rate calendar is Stage 9 — inventing
             one here would be inventing pricing the property has not set. */
          rate: RACK[type] ?? 0,
        };
      }),
    };
  });

  const footer: ChartFooter[] = dates.map((date, i) => {
    const sellable = rooms.filter((r) => sellableOn(r.number, date));
    const taken = sellable.filter((r) =>
      r.bars.some(
        (b) => b.tone !== "void" && b.startIndex <= i && b.startIndex + b.span - 1 >= i,
      ),
    );
    return {
      date,
      availableInventory: sellable.length - taken.length,
      occupancyPct: sellable.length
        ? Math.round((taken.length / sellable.length) * 1000) / 10
        : 0,
    };
  });

  /* Counts derive from the same room state the filters read, so a pill
     can never say six and then show nine. */
  const sellable = rooms.filter((r) => !r.outOfService);
  const counts: Record<string, number> = {
    All: sellable.length,
    Vacant: sellable.filter((r) => !r.state.occupied).length,
    Occupied: sellable.filter((r) => r.state.occupied).length,
    Arrivals: sellable.filter((r) => r.state.arriving).length,
    Reserved: sellable.filter((r) => r.state.reserved).length,
    Blocked: rooms.filter((r) => r.outOfService).length,
    "Due Out": sellable.filter((r) => r.state.dueOut).length,
    Dirty: sellable.filter((r) => r.state.dirty).length,
  };

  return { dates, roomTypes, footer, counts };
}

/** Live counts for the filter pills across the top. */
export async function getStayViewCounts(
  hotelId: string,
  date: string,
): Promise<Record<string, number>> {
  const view = await getStayView(hotelId, date, date);
  return view?.counts ?? {};
}

/** Object surface, so either import convention resolves. */
export const stayViewRepo = {
  get: getStayView,
  counts: getStayViewCounts,
  addDays,
  isWeekend,
  windowFrom,
};
