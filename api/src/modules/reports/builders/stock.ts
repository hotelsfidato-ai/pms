import type { Client } from "../../../db.ts";
import {
  col, row, total, band, round2, pct,
  type Cell, type ReportDoc, type ReportRow, type ReportSection,
} from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S REPORTS (phase 3A of docs/STOCK-AND-EQUIPMENT-PLAN.md;
   the owner's D27-238, and D27-240 for who reads them and how)

   Everything is read from the Store's one ledger, stock_movements (069,
   112, 140): signed quantities, append-only, a mistake reversed by a row
   that points at it. Empty gas cylinders (140) are never stock.

   COSTS ARE AS RECORDED (D27-240 R-2): the price typed on a delivery. An
   item's cost is the weighted average of its deliveries up to the report's
   date - S4's rule, the same sum as app.stock_unit_cost. Whether a typed
   price includes GST is the CA's to settle, so every value says "as
   recorded" and the footnote says why. A movement with no recorded cost is
   a dash, never a zero, and a total leaves it out and says so.

   THE STORES LANE IS ADDING COLUMNS (D27-238 6.2-6.4, crockery): each has
   its place below, marked "STORES LANE", to be wired when they land.
   ══════════════════════════════════════════════════════════════════ */

export const COST_NOTE =
  "Costs as typed on the deliveries; whether they include GST is the CA's to settle (D27-238).";

/** A movement nobody reversed and that reverses nothing: the ledger as it stands. */
const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

/* Each item's average cost as recorded, up to the date in the given
   parameter. STORES LANE: when the running-average cost on the item lands
   (D27-238 6.3), it replaces this one CTE and every report follows. */
const costTo = (dateParam: string) => `
  cost as (
    select m.item_id, round(sum(m.quantity * m.unit_cost) / sum(m.quantity), 2) as unit_cost
      from stock_movements m
     where m.hotel_id = $1 and m.kind = 'receipt' and not m.empty
       and m.unit_cost is not null and m.business_date <= ${dateParam}::date and ${LIVE}
     group by m.item_id
    having sum(m.quantity) > 0)`;

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** "1 item has" / "3 items have" no recorded cost - said under a total. */
const leftOut = (n: number, what: string) => n === 0 ? undefined
  : `${n} ${what}${n === 1 ? " has" : "s have"} no recorded cost and ${n === 1 ? "is" : "are"} left out of the total.`;

/** The sum of the figures held; the unknown ones are left out, and counted. */
const known = (values: Array<number | null>) => ({
  sum: round2(values.reduce<number>((s, v) => s + (v ?? 0), 0)),
  missing: values.filter((v) => v === null).length,
});

const doc = (
  property: Property, report: ReportDoc["report"], title: string, facts: ReportDoc["facts"],
  sections: ReportSection[], footnotes: string[] = [COST_NOTE],
): ReportDoc => ({
  report, title, property: heading(property), orientation: "landscape", facts, sections, footnotes,
});

const asOnFact = (asOn: string) => [{ label: "As On Date", value: asOn, kind: "date" as const }];
const windowFacts = (from: string, to: string) => [
  { label: "From", value: from, kind: "date" as const },
  { label: "To", value: to, kind: "date" as const },
];

/* ── 1 · Closing stock and value, per store ─────────────────────────── */

export async function stockOnHand(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    store: string; item: string; unit: string; category: string | null;
    on_hand: string; unit_cost: string | null; value: string | null;
  }>(
    `with ${costTo("$2")},
     held as (
       select m.item_id, m.location_id, sum(m.quantity) as on_hand
         from stock_movements m
        where m.hotel_id = $1 and not m.empty and m.business_date <= $2::date
        group by m.item_id, m.location_id
       having sum(m.quantity) <> 0)
     select l.name as store, i.name as item, i.unit, i.category, h.on_hand::text,
            c.unit_cost::text, round(h.on_hand * c.unit_cost, 2)::text as value
       from held h
       join stock_items i on i.id = h.item_id
       join locations l on l.id = h.location_id
       left join cost c on c.item_id = h.item_id
      order by (l.name = 'Main store') desc, l.name, i.name`,
    [property.id, asOn]);

  const stores = [...new Set(rows.map((r) => r.store))];
  const columns = [
    col("item", "Item", "text"), col("unit", "Unit", "text"), col("category", "Category", "text"),
    col("onHand", "On hand", "ratio"), col("unitCost", "Unit cost (as recorded)"),
    col("value", "Value (as recorded)"),
  ];
  const sections: ReportSection[] = stores.map((store) => {
    const mine = rows.filter((r) => r.store === store);
    const k = known(mine.map((r) => num(r.value)));
    return {
      key: `store-${store}`, title: store, columns,
      rows: [
        ...mine.map((r) => row({
          item: r.item, unit: r.unit, category: r.category, onHand: Number(r.on_hand),
          unitCost: num(r.unit_cost), value: num(r.value),
        })),
        total({ item: "Total", unit: null, category: null, onHand: null, unitCost: null, value: k.sum }),
      ],
      ...(leftOut(k.missing, "item") ? { note: leftOut(k.missing, "item")! } : {}),
    };
  });
  const perStore = stores.map((store) => {
    const mine = rows.filter((r) => r.store === store);
    return { store, items: mine.length, value: known(mine.map((r) => num(r.value))).sum };
  });
  sections.push({
    key: "all", title: "All stores",
    columns: [col("store", "Store", "text"), col("items", "Items", "count"), col("value", "Value (as recorded)")],
    rows: [
      ...perStore.map((s) => row(s)),
      ...(perStore.length ? [total({
        store: "Total", items: null, value: round2(perStore.reduce((s, p) => s + p.value, 0)),
      })] : []),
    ],
    empty: "Nothing is held in any store on this date.",
  });
  /* STORES LANE: expiry dates on deliveries (D27-238 6.4) add a "Near
     expiry" section here: item, store, quantity, expires. */
  return doc(property, "stock-on-hand", "Closing stock", asOnFact(asOn), sections);
}

/* ── The window's live movements, each with its value as recorded ───── */

interface Moved {
  id: string; day: string; kind: string; item: string; unit: string; store: string;
  quantity: number; value: number | null; note: string | null; by: string | null;
  outlet: string | null; item_id: string;
}

/* A delivery is valued at its own price; anything else at the item's
   average cost as recorded to the window's end. */
async function movedIn(
  client: Client, hotelId: string, from: string, to: string, kinds: readonly string[],
): Promise<Moved[]> {
  const { rows } = await client.query<Omit<Moved, "quantity" | "value"> & { quantity: string; value: string | null }>(
    `with ${costTo("$3")}
     select m.id::text, m.business_date::text as day, m.kind, i.name as item, i.unit, l.name as store,
            m.quantity::text, m.note, s.full_name as by, o.name as outlet, m.item_id::text,
            round(m.quantity * case when m.kind = 'receipt' then m.unit_cost else c.unit_cost end, 2)::text as value
       from stock_movements m
       join stock_items i on i.id = m.item_id
       join locations l on l.id = m.location_id
       left join cost c on c.item_id = m.item_id
       left join staff s on s.id = m.moved_by
       left join pos_outlets o on o.id = m.to_outlet
      where m.hotel_id = $1 and not m.empty and m.business_date between $2::date and $3::date
        and m.kind = any($4::text[]) and ${LIVE}
      order by m.business_date, m.id`,
    [hotelId, from, to, kinds]);
  return rows.map((r) => ({ ...r, quantity: Number(r.quantity), value: num(r.value) }));
}

/** Out of the store is negative in the ledger; a report prints it as it went. */
const out = (v: number | null) => (v === null ? null : round2(-v));

/** A kind's value on a day: 0 when none moved, a dash when none had a cost. */
const dayValue = (ms: Moved[], sign: 1 | -1): number | null => {
  if (ms.length === 0) return 0;
  const priced = ms.filter((m) => m.value !== null);
  return priced.length === 0 ? null : round2(sign * priced.reduce((s, m) => s + m.value!, 0));
};

/* ── 2 · Movement by day and kind ───────────────────────────────────── */

export async function stockMovements(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const ms = await movedIn(client, property.id, from, to,
    ["receipt", "issue", "wastage", "adjustment", "return", "transfer"]);
  const days = [...new Set(ms.map((m) => m.day))];
  const KINDS = [
    ["received", "receipt", 1], ["issued", "issue", -1], ["wasted", "wastage", -1],
    ["corrections", "adjustment", 1], ["returned", "return", -1],
  ] as const;
  const rows: ReportRow[] = days.map((day) => {
    const today = ms.filter((m) => m.day === day);
    const cells: Record<string, Cell> = { day, movements: today.length };
    for (const [key, kind, sign] of KINDS) cells[key] = dayValue(today.filter((m) => m.kind === kind), sign);
    return row(cells);
  });
  const sumOf = (key: string) => round2(rows.reduce((s, r) => s + (Number(r.cells[key]) || 0), 0));
  const unpriced = ms.filter((m) => m.value === null && m.kind !== "transfer").length;
  return doc(property, "stock-movements", "Stock movement by day", windowFacts(from, to), [{
    key: "days", title: "Movement by day and kind",
    columns: [
      col("day", "Day", "date"), col("received", "Received"), col("issued", "Issued"),
      col("wasted", "Wasted"), col("corrections", "Count corrections"), col("returned", "Returned"),
      col("movements", "Movements", "count"),
    ],
    rows: rows.length ? [...rows, total({
      day: "Total", received: sumOf("received"), issued: sumOf("issued"), wasted: sumOf("wasted"),
      corrections: sumOf("corrections"), returned: sumOf("returned"), movements: ms.length,
    })] : [],
    empty: "Nothing moved in the store in this window.",
    note: "Values in rupees, as recorded. A transfer between stores is counted, not valued: it changes no total.",
  }], [
    COST_NOTE,
    ...(unpriced ? [`${unpriced} movement${unpriced === 1 ? " has" : "s have"} no recorded cost and ${unpriced === 1 ? "is" : "are"} left out of the values.`] : []),
  ]);
}

/* ── 3 · Consumption per item and per outlet ────────────────────────── */

export async function stockConsumption(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const ms = await movedIn(client, property.id, from, to, ["issue"]);
  const group = <K extends string>(key: (m: Moved) => K) => {
    const out = new Map<K, Moved[]>();
    for (const m of ms) out.set(key(m), [...(out.get(key(m)) ?? []), m]);
    return out;
  };
  const value = (list: Moved[]) => dayValue(list, -1);
  const items = [...group((m) => m.item)].sort(([a], [b]) => a.localeCompare(b));
  const outlets = [...group((m) => m.outlet ?? "")]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const itemValues = items.map(([, list]) => value(list));
  const outletValues = outlets.map(([, list]) => value(list));
  const itemsKnown = known(itemValues);
  const sections: ReportSection[] = [
    {
      key: "items", title: "Per item",
      columns: [col("item", "Item", "text"), col("unit", "Unit", "text"),
        col("issued", "Issued", "ratio"), col("value", "Value (as recorded)")],
      rows: items.length ? [
        ...items.map(([item, list], i) => row({
          item, unit: list[0]!.unit, issued: round2(-list.reduce((s, m) => s + m.quantity, 0)),
          value: itemValues[i]!,
        })),
        total({ item: "Total", unit: null, issued: null, value: itemsKnown.sum }),
      ] : [],
      empty: "Nothing was issued in this window.",
      ...(leftOut(itemsKnown.missing, "item") ? { note: leftOut(itemsKnown.missing, "item")! } : {}),
    },
    {
      key: "outlets", title: "Per outlet",
      columns: [col("outlet", "Outlet", "text"), col("items", "Items", "count"),
        col("value", "Value (as recorded)")],
      rows: outlets.length ? [
        ...outlets.map(([outlet, list], i) => row({
          outlet: outlet || "No outlet", items: new Set(list.map((m) => m.item_id)).size,
          value: outletValues[i]!,
        })),
        total({ outlet: "Total", items: null, value: known(outletValues).sum }),
      ] : [],
      empty: "Nothing was issued in this window.",
      note: "No outlet: issues to housekeeping, maintenance and the rest, which have no till.",
    },
    /* STORES LANE: a department on issues (D27-238 6.4) adds a third
       section here, "Per department", in the per-outlet shape. */
  ];
  return doc(property, "stock-consumption", "Consumption", windowFacts(from, to), sections);
}

/* ── 4 · Wastage, and 5 · the count's corrections ────────────────────── */

const listColumns = (qtyKey: string, qtyLabel: string) => [
  col("day", "Day", "date"), col("store", "Store", "text"), col("item", "Item", "text"),
  col(qtyKey, qtyLabel, "ratio"), col("unit", "Unit", "text"), col("value", "Value (as recorded)"),
  col("reason", "Reason", "text"), col("by", "By", "text"),
];

export async function stockWastage(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  /* STORES LANE: crockery's breakage (phase 2A) becomes its own kind; this
     report then prints two sections, Wastage and Breakage, in this shape. */
  const ms = await movedIn(client, property.id, from, to, ["wastage"]);
  const k = known(ms.map((m) => out(m.value)));
  return doc(property, "stock-wastage", "Wastage", windowFacts(from, to), [{
    key: "wastage", title: "Wastage", columns: listColumns("quantity", "Quantity"),
    rows: ms.length ? [
      ...ms.map((m) => row({
        day: m.day, store: m.store, item: m.item, quantity: round2(-m.quantity), unit: m.unit,
        value: out(m.value), reason: m.note, by: m.by,
      })),
      total({ day: null, store: null, item: "Total", quantity: null, unit: null, value: k.sum, reason: null, by: null }),
    ] : [],
    empty: "Nothing was wasted in this window.",
    ...(leftOut(k.missing, "line") ? { note: leftOut(k.missing, "line")! } : {}),
  }]);
}

export async function stockCountDifferences(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  /* Every adjustment: the Store calls the kind "count correction", and the
     count sheet writes one per difference, its note naming the count. */
  const ms = await movedIn(client, property.id, from, to, ["adjustment"]);
  const k = known(ms.map((m) => m.value));
  return doc(property, "stock-count-differences", "Count differences", windowFacts(from, to), [{
    key: "corrections", title: "Count corrections", columns: listColumns("difference", "Difference"),
    rows: ms.length ? [
      ...ms.map((m) => row({
        day: m.day, store: m.store, item: m.item, difference: m.quantity, unit: m.unit,
        value: m.value, reason: m.note, by: m.by,
      })),
      total({ day: null, store: null, item: "Total", difference: null, unit: null, value: k.sum, reason: null, by: null }),
    ] : [],
    empty: "No count corrections in this window.",
    note: ["A negative difference: less was counted than the book held.", leftOut(k.missing, "line")]
      .filter(Boolean).join(" "),
  }]);
}

/* ── 6 · Dead stock: nothing went OUT for 30, 60 or 90 days (D27-240 R-3) */

export async function stockDead(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    item: string; store: string; unit: string; on_hand: string; value: string | null;
    last_out: string | null; idle: number;
  }>(
    `with ${costTo("$2")},
     held as (
       select m.item_id, m.location_id, sum(m.quantity) as on_hand,
              max(m.business_date) filter (
                where m.quantity < 0 and m.kind in ('issue', 'wastage', 'transfer')
                  and m.reverses_id is null
                  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)) as last_out,
              min(m.business_date) as first_in
         from stock_movements m
        where m.hotel_id = $1 and not m.empty and m.business_date <= $2::date
        group by m.item_id, m.location_id
       having sum(m.quantity) > 0)
     select i.name as item, l.name as store, i.unit, h.on_hand::text,
            round(h.on_hand * c.unit_cost, 2)::text as value, h.last_out::text,
            ($2::date - coalesce(h.last_out, h.first_in))::int as idle
       from held h
       join stock_items i on i.id = h.item_id
       join locations l on l.id = h.location_id
       left join cost c on c.item_id = h.item_id
      where $2::date - coalesce(h.last_out, h.first_in) >= 30
      order by i.name, l.name`,
    [property.id, asOn]);
  const BANDS = [
    ["Nothing out for 90 days or more", 90, Infinity],
    ["Nothing out for 60 to 89 days", 60, 89],
    ["Nothing out for 30 to 59 days", 30, 59],
  ] as const;
  const out: ReportRow[] = [];
  for (const [label, lo, hi] of BANDS) {
    const mine = rows.filter((r) => r.idle >= lo && r.idle <= hi);
    if (!mine.length) continue;
    out.push(band("item", label), ...mine.map((r) => row({
      item: r.item, store: r.store, onHand: Number(r.on_hand), unit: r.unit, value: num(r.value),
      lastOut: r.last_out, idle: r.idle,
    })));
  }
  return doc(property, "stock-dead", "Dead stock", asOnFact(asOn), [{
    key: "dead", title: "Dead stock",
    columns: [
      col("item", "Item", "text"), col("store", "Store", "text"), col("onHand", "On hand", "ratio"),
      col("unit", "Unit", "text"), col("value", "Value (as recorded)"), col("lastOut", "Last went out", "date"),
      col("idle", "Days since", "count"),
    ],
    rows: out,
    empty: "Everything held went out of its store in the last 30 days.",
    note: "Out means issued, wasted or moved to another store. A dash under Last went out: never, since it came in.",
  }]);
}

/* ── 7 · Days of cover, at the last 7 days' use (D27-240 R-4) ─────────── */

export async function stockCover(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{ item: string; unit: string; on_hand: string; issued: string }>(
    `select i.name as item, i.unit,
            coalesce(sum(m.quantity), 0)::text as on_hand,
            coalesce(-sum(m.quantity) filter (
              where m.kind = 'issue' and m.business_date > $2::date - 7
                and m.reverses_id is null
                and not exists (select 1 from stock_movements r where r.reverses_id = m.id)), 0)::text as issued
       from stock_items i
       join stock_movements m on m.item_id = i.id and not m.empty and m.business_date <= $2::date
      where i.hotel_id = $1
      group by i.id, i.name, i.unit
     having sum(m.quantity) > 0
         or coalesce(sum(m.quantity) filter (where m.kind = 'issue' and m.business_date > $2::date - 7), 0) <> 0
      order by i.name`,
    [property.id, asOn]);
  return doc(property, "stock-cover", "Days of cover", asOnFact(asOn), [{
    key: "cover", title: "Days of cover",
    columns: [
      col("item", "Item", "text"), col("unit", "Unit", "text"), col("onHand", "On hand", "ratio"),
      col("issued", "Issued in the last 7 days", "ratio"),
      col("perDay", "Average issued a day (last 7 days)", "ratio"),
      col("days", "Days of cover (at the last 7 days' use)", "ratio"),
    ],
    rows: rows.map((r) => {
      const onHand = Number(r.on_hand);
      const issued = Number(r.issued);
      return row({
        item: r.item, unit: r.unit, onHand, issued,
        perDay: issued > 0 ? round2(issued / 7) : null,
        days: issued > 0 ? Math.round((onHand * 7 / issued) * 10) / 10 : null,
      });
    }),
    empty: "Nothing is held, and nothing was issued in the last 7 days.",
    note: "The last 7 days are the 7 business days ending on the report's date. A dash: nothing was issued in them.",
  }], []);
}

/* ── 8 · Supplier spend and price trend ─────────────────────────────── */

export async function supplierSpend(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  /* Every delivery in the window: the Store's receipts, which is where a
     purchase order's delivery lands too (receiveIntoStore). The supplier
     as recorded on the delivery.
     STORES LANE: GST on purchases (D27-238 6.2) adds "GST (as recorded)"
     and "Claimable" columns to the per-supplier section. */
  const { rows } = await client.query<{
    item: string; unit: string; supplier: string | null; day: string; id: string;
    unit_cost: string | null; value: string | null;
  }>(
    `select i.name as item, i.unit, nullif(btrim(m.supplier), '') as supplier,
            m.business_date::text as day, m.id::text, m.unit_cost::text,
            round(m.quantity * m.unit_cost, 2)::text as value
       from stock_movements m
       join stock_items i on i.id = m.item_id
      where m.hotel_id = $1 and m.kind = 'receipt' and not m.empty
        and m.business_date between $2::date and $3::date and ${LIVE}
      order by m.business_date, m.id`,
    [property.id, from, to]);

  const bySupplier = new Map<string, typeof rows>();
  for (const r of rows) bySupplier.set(r.supplier ?? "", [...(bySupplier.get(r.supplier ?? "") ?? []), r]);
  const suppliers = [...bySupplier].map(([name, list]) => {
    const values = list.map((r) => num(r.value));
    return { name, deliveries: list.length, value: values.every((v) => v === null) ? null : known(values).sum };
  }).sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name)));

  const priced = rows.filter((r) => r.unit_cost !== null);
  const items = [...new Set(priced.map((r) => r.item))].sort((a, b) => a.localeCompare(b));
  const k = known(suppliers.map((s) => s.value));
  return doc(property, "supplier-spend", "Supplier spend", windowFacts(from, to), [
    {
      key: "suppliers", title: "Spend per supplier",
      columns: [col("supplier", "Supplier", "text"), col("deliveries", "Deliveries", "count"),
        col("value", "Value (as recorded)")],
      rows: suppliers.length ? [
        ...suppliers.map((s) => row({ supplier: s.name || "Not named", deliveries: s.deliveries, value: s.value })),
        total({ supplier: "Total", deliveries: rows.length, value: k.sum }),
      ] : [],
      empty: "No deliveries in this window.",
      ...(leftOut(k.missing, "supplier") ? { note: leftOut(k.missing, "supplier")! } : {}),
    },
    {
      key: "prices", title: "Price trend",
      columns: [col("item", "Item", "text"), col("unit", "Unit", "text"),
        col("first", "First price (as recorded)"), col("last", "Last price (as recorded)"),
        col("change", "Change", "percent")],
      rows: items.map((item) => {
        const mine = priced.filter((r) => r.item === item);
        const first = Number(mine[0]!.unit_cost);
        const last = Number(mine.at(-1)!.unit_cost);
        return row({ item, unit: mine[0]!.unit, first, last, change: first > 0 ? pct(last - first, first) : null });
      }),
      empty: "No delivery in this window had a price.",
      note: "The first and the last delivery's price in the window, per unit.",
    },
  ]);
}
