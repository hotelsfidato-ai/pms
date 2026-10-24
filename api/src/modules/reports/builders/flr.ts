import type { Client } from "../../../db.ts";
import { col, row, total, type Cell, type ReportColumn, type ReportDoc, type ReportRow, type ReportSection } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EXCISE REGISTERS, AS THE BAR KEEPS THEM ON PAPER (the owner's
   D27-361, from photos of the hotel's books, 22 October)

   FORM F.L.R.-1A / 2A / 3A - the day: one row per brand under its kind
   (Whisky, Rum, Wine ...), and for Opening Balance, Receipts, Sales and
   Closing Balance a column per bottle size (2000 ... 50 ml; beer 1500 ...
   275 ml), with the T.P. No. of the day's bills.

   FORM F.L.R.-3 - the month: a row per day, Received (with the Permit
   No.), Sold and Closing Balance, each split into spirits imported and
   Indian made, wines imported and Indian, fermented and mild liquor, by
   size; at the foot Opening, Received, Grand total, Less sold, Less
   breakages, Closing balance.

   WHOLE BOTTLES, the premises as one: the Bar store and the Bar counter
   together. A poured NIP counts as sold the day it is opened (D27-361) -
   the counter's open bottle is not in the closing balance - so Sales is
   what the paper writes: opening + receipts - breakages - closing, the
   closing being whole sealed bottles. Cigarettes and anything with no kind
   of liquor set are not in them. A drink with no bottle size goes under
   "size not set" until Set up gives it one.
   ══════════════════════════════════════════════════════════════════ */

const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

const KINDS: { liquor: string; title: string }[] = [
  { liquor: "whisky", title: "Whisky" }, { liquor: "rum", title: "Rum" }, { liquor: "vodka", title: "Vodka" },
  { liquor: "gin", title: "Gin" }, { liquor: "brandy", title: "Brandy" }, { liquor: "tequila", title: "Tequila" },
  { liquor: "liqueur", title: "Liqueur" }, { liquor: "wine", title: "Wine" },
  { liquor: "beer_strong", title: "Beer (fermented, strong)" }, { liquor: "beer_mild", title: "Beer (mild)" },
  { liquor: "other", title: "Other" },
];
const SPIRIT_SIZES = [2000, 1000, 750, 500, 375, 180, 90, 60, 50];
const BEER_SIZES = [1500, 1000, 650, 500, 330, 275];
const isBeer = (liquor: string) => liquor === "beer_strong" || liquor === "beer_mild";

/* FLR-3's classes, in the paper's order, with its sizes. */
const CLASSES: { key: string; title: string; sizes: number[] }[] = [
  { key: "spirits_imported", title: "Spirits · Imported", sizes: [750, 375, 180] },
  { key: "spirits_indian", title: "Spirits · Indian made", sizes: SPIRIT_SIZES },
  { key: "wines_imported", title: "Wines · Imported", sizes: [750, 375, 180] },
  { key: "wines_indian", title: "Wines · Indian", sizes: [750, 375, 180] },
  { key: "fermented", title: "Fermented liquors", sizes: [1500, 1000, 650, 500, 330] },
  { key: "mild", title: "Mild liquors", sizes: [1000, 650, 500, 330, 275] },
];
const classOf = (d: Drink) =>
  d.liquor === "beer_strong" ? "fermented" : d.liquor === "beer_mild" ? "mild"
    : d.liquor === "wine" ? (d.imported ? "wines_imported" : "wines_indian")
      : d.imported ? "spirits_imported" : "spirits_indian";

interface Drink {
  id: string; name: string; brand: string; liquor: string; imported: boolean;
  /** The bottle's size in ml; null: not set. */
  size: number | null; poured: boolean;
}
/** One drink's day, in whole bottles. */
export interface Day { opening: number; receipts: number; sales: number; breakages: number; closing: number }

/** Whole sealed bottles: the counter's open one (poured) is already sold. */
export const sealed = (store: number, counter: number, poured: boolean) =>
  poured ? Math.floor(store + 1e-9) + Math.floor(counter + 1e-9) : Math.round((store + counter) * 1000) / 1000;

/** "Blenders Pride 180 ml" is the brand "Blenders Pride" when no brand is set. */
const brandOf = (name: string, brand: string | null) => brand?.trim() || name.replace(/\s*\d+(\.\d+)?\s*ml\.?$/i, "").trim() || name;

/** Each drink's days from `from` to `to`, in whole bottles, store and counter together. */
export async function registerDays(client: Client, hotelId: string, from: string, to: string) {
  const { rows: items } = await client.query<{
    id: string; name: string; brand: string | null; liquor: string; imported: boolean; size_ml: number | null;
    count_as: string | null;
  }>(
    `select id::text, name, brand, liquor, imported, size_ml, count_as
       from stock_items where hotel_id = $1 and category = 'Bar' and liquor is not null and count_as is distinct from 'packet'
      order by name`, [hotelId]);
  const drinks: Drink[] = items.map((i) => ({
    id: i.id, name: i.name, brand: brandOf(i.name, i.brand), liquor: i.liquor, imported: i.imported,
    size: i.size_ml ?? (Number(/(\d+)\s*ml\.?$/i.exec(i.name)?.[1]) || null),
    poured: (i.count_as ?? (i.size_ml ? "poured" : "whole")) === "poured",
  }));
  const { rows: places } = await client.query<{ id: string; counter: boolean }>(
    "select id::text, is_bar_counter as counter from locations where hotel_id = $1 and (is_bar_store or is_bar_counter)",
    [hotelId]);
  const counterIds = places.filter((p) => p.counter).map((p) => p.id);
  const ids = drinks.map((d) => d.id);

  const { rows: before } = await client.query<{ item: string; counter: boolean; q: string }>(
    `select m.item_id::text as item, m.location_id::text = any($4) as counter, sum(m.quantity)::text as q
       from stock_movements m
      where m.hotel_id = $1 and m.location_id::text = any($3) and m.item_id::text = any($5)
        and not m.empty and m.business_date < $2::date and ${LIVE}
      group by 1, 2`,
    [hotelId, from, places.map((p) => p.id), counterIds, ids]);
  const { rows: days } = await client.query<{ item: string; counter: boolean; day: string; q: string; receipts: string; broken: string }>(
    `select m.item_id::text as item, m.location_id::text = any($5) as counter, m.business_date::text as day,
            sum(m.quantity)::text as q,
            coalesce(sum(m.quantity) filter (where m.kind = 'receipt'), 0)::text as receipts,
            coalesce(-sum(m.quantity) filter (where m.kind in ('breakage', 'wastage')), 0)::text as broken
       from stock_movements m
      where m.hotel_id = $1 and m.location_id::text = any($4) and m.item_id::text = any($6)
        and not m.empty and m.business_date between $2::date and $3::date and ${LIVE}
      group by 1, 2, 3`,
    [hotelId, from, to, places.map((p) => p.id), counterIds, ids]);
  const { rows: permits } = await client.query<{ day: string; item: string; tp: string }>(
    `select p.business_date::text as day, l.item_id::text as item, p.tp_no as tp
       from bar_purchases p join bar_purchase_lines l on l.purchase_id = p.id
      where p.hotel_id = $1 and p.business_date between $2::date and $3::date and p.tp_no is not null
      group by 1, 2, 3`,
    [hotelId, from, to]);

  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  const byDrink = new Map<string, Day[]>();
  for (const d of drinks) {
    let s = 0, c = 0;
    for (const b of before.filter((x) => x.item === d.id)) (b.counter ? (c += Number(b.q)) : (s += Number(b.q)));
    let prev = sealed(s, c, d.poured);
    const list: Day[] = [];
    for (const day of dates) {
      let receipts = 0, breakages = 0;
      for (const m of days.filter((x) => x.item === d.id && x.day === day)) {
        if (m.counter) c += Number(m.q); else s += Number(m.q);
        receipts += Number(m.receipts);
        breakages += Number(m.broken);
      }
      const closing = sealed(s, c, d.poured);
      const round = (n: number) => Math.round(n * 1000) / 1000;
      list.push({ opening: prev, receipts: round(receipts), breakages: round(breakages), closing,
        sales: round(prev + receipts - breakages - closing) });
      prev = closing;
    }
    byDrink.set(d.id, list);
  }
  return { drinks, dates, byDrink, permits };
}

const sizeKey = (size: number | null) => (size === null ? "x" : String(size));
const sizeLabel = (size: number | null) => (size === null ? "size not set" : `${size}`);
const blankIfNone = (n: number) => (n === 0 ? null : n);

/* ── FORM F.L.R.-1A / 2A / 3A: one day ──────────────────────────────── */
export async function flrDaily(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { drinks, byDrink, permits } = await registerDays(client, property.id, asOn, asOn);
  const PARTS = [
    { key: "opening", label: "Opening Balance" }, { key: "receipts", label: "Receipts" },
    { key: "sales", label: "Sales" }, { key: "closing", label: "Closing Balance" },
  ] as const;
  const sections: ReportSection[] = [];
  for (const kind of KINDS) {
    const mine = drinks.filter((d) => d.liquor === kind.liquor);
    if (!mine.length) continue;
    const base = isBeer(kind.liquor) ? BEER_SIZES : SPIRIT_SIZES;
    const sizes: (number | null)[] = [...base, ...[...new Set(mine.map((d) => d.size))]
      .filter((s) => s === null || !base.includes(s)).sort((a, b) => (b ?? -1) - (a ?? -1))];
    const columns: ReportColumn[] = [col("brand", "Name of the Brand", "text"), col("tp", "T.P. No.", "text"),
      ...PARTS.flatMap((p) => sizes.map((s) => col(`${p.key}_${sizeKey(s)}`, sizeLabel(s), "count", p.label)))];
    const brands = [...new Set(mine.map((d) => d.brand))].sort((a, b) => a.localeCompare(b));
    const sums: Record<string, number> = {};
    const rows: ReportRow[] = brands.map((brand) => {
      const ofBrand = mine.filter((d) => d.brand === brand);
      const cells: Record<string, Cell> = {
        brand,
        tp: [...new Set(permits.filter((p) => ofBrand.some((d) => d.id === p.item)).map((p) => p.tp))].join(", ") || null,
      };
      for (const p of PARTS) {
        for (const s of sizes) {
          const at = ofBrand.filter((d) => d.size === s);
          if (!at.length) { cells[`${p.key}_${sizeKey(s)}`] = null; continue; }
          const v = at.reduce((n, d) => n + byDrink.get(d.id)![0]![p.key], 0);
          cells[`${p.key}_${sizeKey(s)}`] = p.key === "opening" || p.key === "closing" ? v : blankIfNone(v);
          sums[`${p.key}_${sizeKey(s)}`] = (sums[`${p.key}_${sizeKey(s)}`] ?? 0) + v;
        }
      }
      return row(cells);
    });
    rows.push(total({ brand: "Total", tp: null, ...Object.fromEntries(Object.entries(sums)) }));
    sections.push({ key: `flr-${kind.liquor}`, title: kind.title, columns, rows });
  }
  return {
    report: "flr-daily", title: "FORM F.L.R.-1A / 2A / 3A", property: heading(property), orientation: "landscape",
    facts: [{ label: "Date", value: asOn, kind: "date" }],
    sections: sections.length ? sections : [{
      key: "flr-none", title: "The register", columns: [col("brand", "Name of the Brand", "text")], rows: [],
      empty: "No drink has its kind of liquor set: set it in Bar stock, Set up.",
    }],
    footnotes: [
      "Whole bottles, the Bar store and the Bar counter together. A NIP poured as pegs counts as sold the day it is opened.",
      "Sales = opening + receipts - breakages - closing. T.P. No.: the transport permit on the day's bar bills.",
    ],
  };
}

/* ── FORM F.L.R.-3: one month ───────────────────────────────────────── */
export async function flrMonthly(client: Client, property: Property, month: string): Promise<ReportDoc> {
  const first = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const last = end < property.businessDate ? end : property.businessDate < first ? first : property.businessDate;
  const { drinks, dates, byDrink, permits } = await registerDays(client, property.id, first, last);

  const classes = CLASSES.map((k) => {
    const mine = drinks.filter((d) => classOf(d) === k.key);
    const extra = [...new Set(mine.map((d) => d.size))].filter((s) => s === null || !k.sizes.includes(s))
      .sort((a, b) => (b ?? -1) - (a ?? -1));
    return { ...k, all: [...k.sizes, ...extra] as (number | null)[], mine };
  });
  const keyOf = (k: string, s: number | null) => `${k}_${sizeKey(s)}`;
  const valueCols = classes.flatMap((k) => k.all.map((s) => col(keyOf(k.key, s), sizeLabel(s), "count", k.title)));
  /** What a part of the day sums to per class and size; null where the hotel has no such drink. */
  const cellsFor = (pick: (d: Day) => number, i: number | null, blankZero: boolean) => {
    const cells: Record<string, Cell> = {};
    for (const k of classes) {
      for (const s of k.all) {
        const at = k.mine.filter((d) => d.size === s);
        if (!at.length) { cells[keyOf(k.key, s)] = null; continue; }
        const v = Math.round(at.reduce((n, d) => {
          const list = byDrink.get(d.id)!;
          return n + (i === null ? list.reduce((m, day) => m + pick(day), 0) : pick(list[i]!));
        }, 0) * 1000) / 1000;
        cells[keyOf(k.key, s)] = blankZero && v === 0 ? null : v;
      }
    }
    return cells;
  };
  const dayLabel = (iso: string) => String(Number(iso.slice(8, 10)));
  const permitOf = (day: string) => [...new Set(permits.filter((p) => p.day === day).map((p) => p.tp))].join(", ") || null;
  const opening = (() => {
    const cells: Record<string, Cell> = {};
    for (const k of classes) for (const s of k.all) {
      const at = k.mine.filter((d) => d.size === s);
      cells[keyOf(k.key, s)] = at.length ? at.reduce((n, d) => n + (byDrink.get(d.id)![0]?.opening ?? 0), 0) : null;
    }
    return cells;
  })();
  const add = (a: Record<string, Cell>, b: Record<string, Cell>, sign = 1) =>
    Object.fromEntries(Object.keys(a).map((k) => [k, a[k] === null ? null : Math.round(((a[k] as number) + sign * ((b[k] as number) ?? 0)) * 1000) / 1000]));

  const received = cellsFor((d) => d.receipts, null, false);
  const sold = cellsFor((d) => d.sales, null, false);
  const broken = cellsFor((d) => d.breakages, null, false);
  const grand = add(opening, received);
  const closing = add(add(grand, sold, -1), broken, -1);

  const head = (first: string) => [col("day", "Date", "text"), col("permit", first, "text")];
  const sections: ReportSection[] = [
    { key: "flr3-received", title: "Received", columns: [...head("Permit No."), ...valueCols],
      rows: [
        ...dates.map((day, i) => row({ day: dayLabel(day), permit: permitOf(day), ...cellsFor((d) => d.receipts, i, true) })),
        total({ day: "Total", permit: null, ...received }),
      ] },
    { key: "flr3-sold", title: "Sold", columns: [...head(""), ...valueCols],
      rows: [
        ...dates.map((day, i) => row({ day: dayLabel(day), permit: null, ...cellsFor((d) => d.sales, i, true) })),
        total({ day: "Total", permit: null, ...sold }),
      ] },
    { key: "flr3-closing", title: "Closing Balance", columns: [...head(""), ...valueCols],
      rows: [
        row({ day: "Balance of the last month", permit: null, ...opening }),
        ...dates.map((day, i) => row({ day: dayLabel(day), permit: null, ...cellsFor((d) => d.closing, i, false) })),
        total({ day: "Opening Balance", permit: null, ...opening }),
        row({ day: "Received", permit: null, ...received }),
        total({ day: "Grand Total", permit: null, ...grand }),
        row({ day: "Less Sold (Sales)", permit: null, ...sold }),
        row({ day: "Less Breakages", permit: null, ...broken }),
        total({ day: "Closing Balance", permit: null, ...closing }),
      ] },
  ];
  return {
    report: "flr-monthly", title: "FORM F.L.R.-3", property: heading(property), orientation: "landscape",
    facts: [{ label: "During the month of", value: month, kind: "text" }, { label: "Up to", value: last, kind: "date" }],
    sections,
    footnotes: [
      "Register of transaction of foreign liquor: number of bottles, the Bar store and the Bar counter together.",
      "A NIP poured as pegs counts as sold the day it is opened. Permit No.: the T.P. on the day's bar bills.",
    ],
  };
}
