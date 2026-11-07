import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT IS ABOUT TO EXPIRE, OR HAS, AND IS STILL ON THE SHELF
   (the owner's D27-383, item 11)

   A delivery's use-by is recorded on its receipt (180). What is left of
   each delivery is not stored anywhere: it is worked out here from the
   movements, per item and per store, FIRST EXPIRING FIRST OUT - stock
   going out of a store is taken from the delivery with the earliest
   use-by there (decided under D27-396: then Waste of the expired stock
   takes off exactly that delivery). A delivery with no use-by is taken
   last, as keeping; it is never an alert and never a guess.

   A move between stores carries each piece's use-by with it; an undo
   puts back exactly what its movement took, or takes off exactly what its
   movement put. Stock gone below nothing (the kitchen's KOTs may do that)
   is owed, and the next delivery pays it first.

   ponytail: every movement of every item that ever had a use-by, per
   read - fine for a hotel's few hundred items; keep the lots in a table
   if the Store ever reads slowly.
   ══════════════════════════════════════════════════════════════════ */

export interface Move {
  id: string; item: string; place: string; kind: string;
  /** Signed, as written. */
  quantity: number;
  /** A receipt's use-by, YYYY-MM-DD. */
  useBy: string | null;
  /** The business day it was written. */
  day: string;
  reverses: string | null; transfer: string | null;
}

/** What is left of one delivery in one place. */
export interface Lot { item: string; place: string; quantity: number; useBy: string | null; receivedOn: string }

type Piece = { n: number; useBy: string | null; receivedOn: string; from: string };

/** What is left of each delivery, per item and place. Pure: the movements in
    the order they were written (their id). */
export function lotsLeft(moves: readonly Move[]): Lot[] {
  /* In thousandths, as numeric(12,3) holds them: no float dust. */
  const milli = (q: number) => Math.round(q * 1000);
  const shelves = new Map<string, { item: string; place: string; lots: Piece[]; owed: number }>();
  const shelf = (m: Move) => {
    const key = `${m.item}|${m.place}`;
    return shelves.get(key) ?? shelves.set(key, { item: m.item, place: m.place, lots: [], owed: 0 }).get(key)!;
  };
  /* What each out-movement took: for its undo, and for its move's other half. */
  const taken = new Map<string, Piece[]>();

  const take = (m: Move, n: number): Piece[] => {
    const s = shelf(m);
    /* What this movement undoes first; then the earliest use-by; none last. */
    s.lots.sort((a, b) => Number(b.from === m.reverses) - Number(a.from === m.reverses)
      || (a.useBy ?? "9999").localeCompare(b.useBy ?? "9999") || a.receivedOn.localeCompare(b.receivedOn));
    const out: Piece[] = [];
    while (n > 0 && s.lots.length) {
      const lot = s.lots[0]!;
      const k = Math.min(n, lot.n);
      out.push({ ...lot, n: k });
      lot.n -= k; n -= k;
      if (lot.n === 0) s.lots.shift();
    }
    s.owed += n;
    return out;
  };
  const put = (m: Move, n: number, pieces: Piece[]) => {
    const s = shelf(m);
    const short = n - pieces.reduce((t, p) => t + p.n, 0);
    for (const p of short > 0 ? [...pieces, { n: short, useBy: null, receivedOn: m.day, from: m.id }] : pieces) {
      const pay = Math.min(s.owed, p.n);
      s.owed -= pay;
      if (p.n > pay) s.lots.push({ ...p, n: p.n - pay, from: m.id });
    }
  };

  const outHalf = new Map<string, string>();
  const step = (m: Move) => {
    const n = milli(m.quantity);
    if (n < 0) { taken.set(m.id, take(m, -n)); return; }
    const back = m.reverses ? taken.get(m.reverses) : undefined;
    const moved = !m.reverses && m.transfer ? taken.get(outHalf.get(m.transfer) ?? "") : undefined;
    put(m, n, back ?? moved
      ?? [{ n, useBy: m.kind === "receipt" ? m.useBy : null, receivedOn: m.day, from: m.id }]);
  };

  /* A move's two halves together, the half going out first. */
  const halves = new Map<string, Move[]>();
  for (const m of moves) if (m.transfer && !m.reverses) halves.set(m.transfer, [...(halves.get(m.transfer) ?? []), m]);
  const done = new Set<string>();
  for (const m of moves) {
    if (done.has(m.id)) continue;
    const pair = m.transfer && !m.reverses ? halves.get(m.transfer)! : [m];
    for (const x of [...pair].sort((a, b) => a.quantity - b.quantity)) {
      if (x.quantity < 0 && x.transfer) outHalf.set(x.transfer, x.id);
      step(x);
      done.add(x.id);
    }
  }

  /* One line per delivery in a place: a delivery taken out and put back, or
     moved away and back, is pieces of itself - added up again. */
  const out = new Map<string, Lot>();
  for (const s of shelves.values()) {
    for (const l of s.lots) {
      const key = `${s.item}|${s.place}|${l.useBy}|${l.receivedOn}`;
      const had = out.get(key);
      if (had) had.quantity += l.n;
      else out.set(key, { item: s.item, place: s.place, quantity: l.n, useBy: l.useBy, receivedOn: l.receivedOn });
    }
  }
  return [...out.values()].filter((l) => l.quantity > 0).map((l) => ({ ...l, quantity: l.quantity / 1000 }));
}

export interface ExpiryAlert {
  itemId: string; item: string; unit: string; storeId: string; store: string;
  /** What is left of that delivery there. */
  quantity: number;
  useBy: string;
  /** The business day the delivery was received. */
  receivedOn: string;
  /** The use-by is before today: it should not be used. */
  expired: boolean;
}

/** Every delivery still on a shelf whose use-by is past, or within the
    hotel's warning period - oldest use-by first. `today` is the property's
    calendar day, not its business day: a night audit running late does not
    keep milk fresh. The caller has asked its own grant. */
export async function expiryAlerts(client: Client, hotelId: string): Promise<{
  warnDays: number; today: string; alerts: ExpiryAlert[];
}> {
  const { rows: [h] } = await client.query<{ warn: number; today: string }>(
    `select expiry_warn_days as warn, to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today
       from hotels where id = $1`, [hotelId]);
  const { rows } = await client.query<{
    id: string; item: string; place: string; kind: string; quantity: string; use_by: string | null;
    day: string; reverses: string | null; transfer: string | null;
  }>(
    `select m.id::text, m.item_id::text as item, m.location_id::text as place, m.kind, m.quantity::text,
            to_char(m.expires_on, 'YYYY-MM-DD') as use_by, to_char(m.business_date, 'YYYY-MM-DD') as day,
            m.reverses_id::text as reverses, m.transfer_id::text as transfer
       from stock_movements m
      where m.hotel_id = $1 and not m.empty
        and m.item_id in (select d.item_id from stock_movements d where d.hotel_id = $1 and d.expires_on is not null)
      order by m.id`, [hotelId]);
  const { warn, today } = h!;
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + warn * 86_400_000).toISOString().slice(0, 10);
  const due = lotsLeft(rows.map((r) => ({
    id: r.id, item: r.item, place: r.place, kind: r.kind, quantity: Number(r.quantity), useBy: r.use_by,
    day: r.day, reverses: r.reverses, transfer: r.transfer,
  }))).filter((l): l is Lot & { useBy: string } => l.useBy !== null && l.useBy <= until);
  if (due.length === 0) return { warnDays: warn, today, alerts: [] };

  const { rows: names } = await client.query<{ id: string; name: string; unit: string | null }>(
    `select id::text, name, unit from stock_items where hotel_id = $1 and id = any($2::uuid[])
     union all
     select id::text, name, null from locations where hotel_id = $1 and id = any($3::uuid[])`,
    [hotelId, [...new Set(due.map((l) => l.item))], [...new Set(due.map((l) => l.place))]]);
  const named = new Map(names.map((n) => [n.id, n]));
  return {
    warnDays: warn, today,
    alerts: due
      .map((l) => ({
        itemId: l.item, item: named.get(l.item)?.name ?? "-", unit: named.get(l.item)?.unit ?? "",
        storeId: l.place, store: named.get(l.place)?.name ?? "-",
        quantity: l.quantity, useBy: l.useBy, receivedOn: l.receivedOn, expired: l.useBy < today,
      }))
      .sort((a, b) => a.useBy.localeCompare(b.useBy) || a.item.localeCompare(b.item)
        || a.store.localeCompare(b.store) || a.receivedOn.localeCompare(b.receivedOn)),
  };
}

/** The setting's bounds (269's check says the same). */
export const isWarnDays = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 90;
