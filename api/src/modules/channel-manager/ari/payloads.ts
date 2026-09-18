import type { AriSnapshot } from "./source.ts";

/* ══════════════════════════════════════════════════════════════════
   RATES AND AVAILABILITY IN SU's SHAPE — part 3

   SU's "Rates and Availability" (POST /SUAPI/jservice/availability):

     { hotelid, room: [ { roomid, date: [ … ] } ] }

   A date entry is a single day ("value") or a range ("from", "to", both
   included), and says one of two things:

     ROOM LEVEL   roomstosell, and no rate. SU: "Rate should not be
                  specified when updating roomstosell." The PMS counts rooms
                  per room type, not per meal plan, so rooms left is sent
                  once per room type.
     RATE LEVEL   rate: [{ rateplanid }], price: [{ NumberOfGuests, value }],
                  extraadultrate, extrachildrate, closed, minimumstay,
                  maximumstay, closedonarrival, closedondeparture.

   Consecutive days that say exactly the same thing travel as one range:
   "STAAH prefers IT Providers to issue one large request … with combined
   dates as much as possible". Requests are cut to 1,000 entries, well under
   SU's recommended 512 KB.

   THE CELL is one thing SU holds for one date: a room type's rooms left, or
   one meal plan's price and restrictions on it. Cells are what gets compared
   with what SU was last sent, so a change on the 14th sends the 14th and
   nothing else.

   WHAT IS NOT SENT, AND WHY
   - A price nobody set. `null` stays out of `price`.
   - A price of zero, even a typed one. Zero on a booking site sells the room
     for nothing; it is counted with the unpriced dates for the owner to see.
   - A guest count that is not priced (Deluxe for three, with no extra-adult
     figure): that count is left out, the others go.
   - maximumstay when the PMS has none: SU's documents do not say what value
     means "no maximum", so nothing is guessed. Clearing a maximum that SU
     already holds is recorded as an open question for SU, in MODULE.md.
   - Nothing at all about a meal plan on a date with no price, WHEN the owner
     has not said to close it: "closed: 0" would open the rate on SU, where an
     old price may still be held. With D17-81 answered (closed), such a date
     goes as closed instead.
   - The owner's answers are held in `AriPolicy`, so what goes to SU can be
     read in one place and changed in one place.

   THE RACK RATE DOES GO (D17-92, 18 September). Where a meal plan has no price
   of its own the room type's own rate goes, rather than the date closing: a
   closed date sells nothing at all, while the rack rate keeps the room selling
   until somebody prices that plan. It is the same figure for room only and for
   breakfast, so breakfast sells at the room-only price meanwhile — the owner's
   call, made knowing that. Every such cell carries `priceSource: "rack"`, which
   is written into what SU was last sent (110) and counted for the screen, so a
   later question about a night's price has an answer.
   ══════════════════════════════════════════════════════════════════ */

export interface AriPolicy {
  /** D17-92, the owner's: a "rack" price goes to SU. That is the room type's
      own rate, used when nothing was set for the meal plan and date, and it
      is the same figure for room only and for breakfast. */
  sendRackRate: boolean;
  /** D17-81, answered by the owner on 17 September: a date with no price goes
      to SU CLOSED for that meal plan, without anybody pressing anything. SU
      cannot take a price back, so a cleared price would otherwise stay selling
      at its old figure. */
  closeUnpriced: boolean;
}

/** What the owner has said. D17-81: a date with no price anywhere is closed.
    D17-92: where the meal plan has no price of its own, the room type's rack
    rate goes rather than the date closing. */
export const THE_OWNERS_POLICY: AriPolicy = {
  sendRackRate: true,
  closeUnpriced: true,
};

export interface AriCell {
  roomTypeId: string;
  suRoomId: string;
  /** null for the room-level cell (rooms left). */
  mealPlan: string | null;
  suRatePlanId: string | null;
  date: string;
  /** Exactly the fields SU receives for this date, without the date. */
  value: Record<string, unknown>;
  /** Where the price in `value` came from, kept with what SU was last sent so a
      later question about a night has an answer (110). Null when the cell
      carries no price: rooms left, or a date closed for want of one. */
  priceSource: "typed" | "derived" | "rack" | null;
}

export const cellKey = (c: Pick<AriCell, "roomTypeId" | "mealPlan" | "date">) =>
  `${c.roomTypeId}|${c.mealPlan ?? "-"}|${c.date}`;

export interface CellSummary {
  cells: AriCell[];
  /** Dates a meal plan had no price that could go (the owner sees the count). */
  unpricedDates: number;
  /** Dates whose price was the room type's rack rate because the meal plan had
      none of its own (D17-92): sent, and counted so the owner can see how much
      is selling at a figure nobody typed for that plan. */
  rackDates: number;
}

const flag = (b: boolean) => (b ? "1" : "0");

export function ariCells(snapshot: AriSnapshot, policy: AriPolicy): CellSummary {
  const cells: AriCell[] = [];
  let unpricedDates = 0;
  let rackDates = 0;

  for (const room of snapshot.rooms) {
    const dayByDate = new Map(room.days.map((d) => [d.date, d]));

    for (const day of room.days) {
      cells.push({
        roomTypeId: room.roomTypeId, suRoomId: room.suRoomId, mealPlan: null, suRatePlanId: null,
        date: day.date, value: { roomstosell: String(day.roomsLeft) }, priceSource: null,
      });
    }

    for (const plan of room.plans) {
      for (const p of plan.prices) {
        const day = dayByDate.get(p.date);
        if (!day) continue;

        const priceAllowed = p.source === "typed" || p.source === "derived"
          || (p.source === "rack" && policy.sendRackRate);

        const price = priceAllowed
          ? p.byGuests.flatMap((v, i) => (v === null || !(Number(v) > 0)
              ? [] : [{ NumberOfGuests: String(i + 1), value: v }]))
          : [];
        if (price.length === 0) unpricedDates += 1;
        /* Counted when it actually goes, not when it is refused: the owner reads
           it as how many nights are selling at a figure nobody typed for this
           meal plan (D17-92). */
        if (p.source === "rack" && price.length > 0) rackDates += 1;
        /* No price, nobody closed it, and closing unpriced dates is not the
           owner's rule: nothing is said to SU about this date. */
        if (price.length === 0 && !day.stopSell && !policy.closeUnpriced) continue;

        const value: Record<string, unknown> = {
          rate: [{ rateplanid: plan.suRatePlanId }],
          ...(price.length > 0 ? { price } : {}),
          ...(priceAllowed && p.extraAdult !== null ? { extraadultrate: p.extraAdult } : {}),
          ...(priceAllowed && p.extraChild !== null ? { extrachildrate: p.extraChild } : {}),
          closed: flag(day.stopSell || (price.length === 0 && policy.closeUnpriced)),
          minimumstay: String(day.minNights ?? 1),
          ...(day.maxNights !== null ? { maximumstay: String(day.maxNights) } : {}),
          closedonarrival: flag(day.closedArrival),
          closedondeparture: flag(day.closedDeparture),
        };
        cells.push({
          roomTypeId: room.roomTypeId, suRoomId: room.suRoomId,
          mealPlan: plan.mealPlan, suRatePlanId: plan.suRatePlanId,
          date: p.date, value,
          priceSource: price.length > 0 ? p.source : null,
        });
      }
    }
  }
  return { cells, unpricedDates, rackDates };
}

const ENTRIES_PER_REQUEST = 1000;

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** SU's requests for these cells: one range per run of identical days, per
    room type and meal plan, cut to ENTRIES_PER_REQUEST entries. */
export function ariRequests(suHotelId: string, cells: AriCell[]): Array<{
  payload: { hotelid: string; room: Array<{ roomid: string; date: Record<string, unknown>[] }> };
  cells: AriCell[];
}> {
  /* Group by room type, then by what the cell is about (rooms, or a plan). */
  const groups = new Map<string, AriCell[]>();
  for (const c of [...cells].sort((a, b) => cellKey(a).localeCompare(cellKey(b)))) {
    const key = `${c.suRoomId}|${c.suRatePlanId ?? "-"}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  type Entry = { suRoomId: string; entry: Record<string, unknown>; cells: AriCell[] };
  const entries: Entry[] = [];
  for (const list of groups.values()) {
    let run: AriCell[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      entries.push({
        suRoomId: first.suRoomId,
        entry: run.length === 1
          ? { value: first.date, ...first.value }
          : { from: first.date, to: last.date, ...first.value },
        cells: run,
      });
      run = [];
    };
    for (const c of list) {
      const prev = run[run.length - 1];
      const same = prev
        && nextDay(prev.date) === c.date
        && JSON.stringify(prev.value) === JSON.stringify(c.value);
      if (!same) flush();
      run.push(c);
    }
    flush();
  }

  const requests: ReturnType<typeof ariRequests> = [];
  for (let i = 0; i < entries.length; i += ENTRIES_PER_REQUEST) {
    const slice = entries.slice(i, i + ENTRIES_PER_REQUEST);
    const rooms = new Map<string, Record<string, unknown>[]>();
    for (const e of slice) {
      const list = rooms.get(e.suRoomId) ?? [];
      list.push(e.entry);
      rooms.set(e.suRoomId, list);
    }
    requests.push({
      payload: {
        hotelid: suHotelId,
        room: [...rooms.entries()].map(([roomid, date]) => ({ roomid, date })),
      },
      cells: slice.flatMap((e) => e.cells),
    });
  }
  return requests;
}
