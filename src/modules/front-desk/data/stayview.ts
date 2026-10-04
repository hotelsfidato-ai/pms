import { listAllRooms } from "@/data/repositories/rooms";
import { listStays, getHouseNow } from "./stays";
import type { Stay } from "@/data/repositories/types";
import { listOpenFolios } from "@/modules/finance";
import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   STAY VIEW — the tape chart's data

   Fourteen days across seventeen rooms, on one screen, with no
   horizontal scroll. Everything here is shaped for that: the chart
   asks for a window and gets back exactly what it draws.
   ══════════════════════════════════════════════════════════════════ */

/* RACK used to live here — { Superior: 4099, Deluxe: 3699 } — and the
   chart read `RACK[type] ?? 0` for its per-date rate. Two consequences,
   both wrong: a property whose types are not called Superior or Deluxe
   showed ₹0 across the whole chart, and any hotel that changed its
   prices had a frontend constant quietly disagreeing with its own
   database.

   The rate now comes from the server, and is null when the hotel has not
   set one. Since D27-271 (item 3) it is each night's own: see nightPrices. */

/* ⚠ "departed" WAS CALLED "tentative", and it only ever meant checked
   out — see barTone below. The stay panel printed the name, so every
   departed guest read "Tentative", which at a front desk means a booking
   nobody has confirmed. Found 14 September, on the rebuilt panel. */
export type BarTone =
  | "in-house" | "confirmed" | "departed" | "due-out" | "no-show" | "void"
  /* Held for the hotel to confirm (Phase 1): "Waiting for the hotel". */
  | "waiting";

export interface ChartBar {
  stay: Stay;
  /** 0-based index into the window. */
  startIndex: number;
  /** Number of columns the bar spans — always at least 1. */
  span: number;
  tone: BarTone;
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Undefined for a role the server gives no bills (D27-143). */
  balance: number | undefined;
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
  perDate: Array<{ date: string; available: number; rate: number | null }>;
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

/** One of the hotel's weekend days (D27-243 3.4: its own, Saturday and
    Sunday until it says otherwise). Shading only - no price reads it. */
export function isWeekend(iso: string, days: readonly number[] = [0, 6]): boolean {
  return days.includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
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
  if (stay.status === "checked-out") return "departed";
  if (stay.status === "tentative") return "waiting";
  /* due-in: expected, possibly today, but nobody has arrived yet. */
  return "confirmed";
}

/** A day-use stay occupies its single date; everything else its nights. */
function occupiedDates(stay: Stay): { from: string; to: string } {
  return stay.isDayUse
    ? { from: stay.arrival, to: stay.arrival }
    : { from: stay.arrival, to: addDays(stay.departure, -1) };
}

/** The stays whose nights the Manager report counts sold (figures.ts). */
const SOLD = new Set<Stay["status"]>(["due-in", "in-house", "due-out", "checked-out"]);

/* ── The chart ────────────────────────────────────────────────────── */

/** Each room type's price on each night of the window, in one read: the
    Rates screen's main row (app.price_for on EP) - the night's own price,
    else the type's standard price, else null (D27-271 item 3). */
async function nightPrices(hotelId: string, from: string, days: number) {
  try {
    return await api<Array<{ type: string; date: string; price: number | null }>>(
      `/api/hotels/${hotelId}/calendar-prices?from=${from}&days=${days}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

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
  const [allRooms, allStays, openFolios, houseNow, prices] = await Promise.all([
    listAllRooms(hotelId),
    listStays(hotelId),
    /* Refused to a role that reads bookings but not bills (D27-143): the
       board still draws, with no balance at all rather than ₹0. */
    listOpenFolios(hotelId).catch((error) => {
      if (error instanceof ApiError && error.status === 403) return null;
      throw error;
    }),
    getHouseNow(hotelId),
    nightPrices(hotelId, first, length),
  ]);

  if (allRooms.length === 0) return null;

  /* IN HOUSE AND OUT OF SERVICE TONIGHT ARE THE SERVER'S (D21-36, D21-37).
     This page used to work both out for itself from the stays and the
     blocks, and the property page worked them out another way - 11 in
     house there, 10 here, the same minute. */
  const now = new Map((houseNow?.rooms ?? []).map((r) => [r.number, r]));

  /* A folio only appears in `openFolios` when it carries a balance,
     so absent IS zero. Looking each one up separately would have been
     eighty-three more requests to learn the same thing. */
  const balances = new Map((openFolios ?? []).map((f) => [f.stayId, f.balance]));
  const balanceOf = (stayId: string) =>
    openFolios === null ? undefined : balances.get(stayId) ?? 0;

    /* Whether a room could be SOLD on a date.

       This asked `room.status !== "out-of-service" ||
       EXTRA_ROOM_DATES.includes(date)` — a hardcoded list of six
       August dates in a fixture file, because nothing in the schema
       recorded why a room came back into inventory for a week.
       Migration 022 records it, and every room now arrives carrying
       its block ranges.

       INCLUSIVE on both ends, matching app.sellable_rooms exactly:
       `p_date >= b.from_date and (b.to_date is null or p_date <= b.to_date)`.
       The first version of this predicate wrote `date < b.to` from
       habit — half-open, like the daterange the booking constraints
       use — and would have shifted the boundary by one day, making the
       tape chart disagree with the occupancy denominator on two dates
       out of every block. A block with no `to` is open-ended. */
    const sellableOn = (roomNumber: string, date: string) => {
      const room = allRooms.find((r) => r.number === roomNumber);
      if (!room) return false;
      return !room.blocks.some(
        (b) => date >= b.from && (b.to === null || date <= b.to),
      );
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
      /* THE DATED BLOCK decides (INV-6, the owner's D17-11): the same
         record availability, occupancy and the bell read. The room's
         status alone said room 308 was clean while a block held it out. */
      outOfService: now.get(room.number)?.outOfOrder ?? false,
      bars,
      /* All four read STATUS where status is what changes. A room is
         occupied when someone has actually checked in, not merely
         because a booking covers tonight — otherwise a check-in moves
         no number and the clerk cannot see their work land. Occupied is
         the server's one rule, app.in_house. */
      state: {
        occupied: now.get(room.number)?.inHouse ?? false,
        arriving: live.some((s) => s.status === "due-in" && s.arrival === businessDate),
        reserved: live.some((s) => s.status === "due-in" && s.arrival > businessDate),
        dueOut: live.some((s) => s.status === "due-out" || (s.status === "in-house" && s.departure === businessDate)),
        dirty: room.status === "dirty",
      },
    };
  });

  /* Group by room type, in the order the property declares them. */
  const types = [...new Set(allRooms.map((r) => r.type))];

  const priceOn = new Map((prices ?? []).map((p) => [`${p.type}/${p.date}`, p.price]));
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
          /* That night's own price (D27-271 item 3). Null and not 0: the
             chart prints a dash. */
          rate: priceOn.get(`${type}/${date}`) ?? null,
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
    /* OCCUPANCY IS THE MANAGER REPORT'S (the owner's D27-151, QA RP-1): a
       night of a booking confirmed, in house or checked out, complimentary
       included, over the sellable rooms. A no-show, a tentative booking and
       a day use are not nights sold; it counted every room with a bar, so
       a no-show's room read as sold. */
    const sold = allStays.filter((s) => SOLD.has(s.status) && !s.isDayUse
      && s.arrival <= date && date < s.departure).length;
    return {
      date,
      availableInventory: sellable.length - taken.length,
      occupancyPct: sellable.length
        ? Math.round((sold / sellable.length) * 1000) / 10
        : 0,
    };
  });

  /* Counts derive from the same room state the filters read, so a pill
     can never say six and then show nine.

     In house (Occupied) counts EVERY room with a guest in it, blocked or
     not - D21-36 does not stop counting a guest because a block started;
     Empty (Vacant) is nobody in it AND sellable (D21-37). The same three
     numbers as the server's house-now, which src/modules/front-desk/
     inHouseRule.test.tsx holds every screen to. */
  const sellable = rooms.filter((r) => !r.outOfService);
  const counts: Record<string, number> = {
    All: sellable.length,
    Vacant: sellable.filter((r) => !r.state.occupied).length,
    Occupied: rooms.filter((r) => r.state.occupied).length,
    Arrivals: sellable.filter((r) => r.state.arriving).length,
    Reserved: sellable.filter((r) => r.state.reserved).length,
    Blocked: rooms.filter((r) => r.outOfService).length,
    "Due Out": sellable.filter((r) => r.state.dueOut).length,
    Dirty: sellable.filter((r) => r.state.dirty).length,
  };

  return { dates, roomTypes, footer, counts };
}
