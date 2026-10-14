import type { Client } from "../../../db.ts";
import { ROLES, can } from "../../../permissions.ts";
import { outletSales } from "../../pos/index.ts";
import {
  col, row, total, band, round2, pct,
  type Cell, type ReportDoc, type ReportRow, type ReportSection,
} from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S REPORTS (phase 3A of docs/STOCK-AND-EQUIPMENT-PLAN.md;
   the owner's D27-238, D27-240 for who reads them and how, D27-242)

   Everything is read from the Store's one ledger, stock_movements (069,
   112, 140, and "store days, GST and crockery"): signed quantities,
   append-only, a mistake reversed by a row that points at it. Empty gas
   cylinders (140) are never stock.

   EVERY VALUE IS ITS MOMENT'S (D27-238 6.3): app.stock_movement_costs walks
   each item's movements in order - a delivery is worth what was paid, and
   everything else leaves at the running average of its moment. So an issue
   in March keeps March's cost, and a later dearer delivery does not
   restate it. A cost on a date is the running average after that date's
   last movement. Prices are typed BEFORE GST; the GST of a delivery is its
   own three columns. No price recorded is a dash, never a zero, and a
   total leaves it out and says so.
   ══════════════════════════════════════════════════════════════════ */

export const COST_NOTE =
  "Costs as recorded: delivery prices before GST, each item at its running average at the moment.";

/** A movement nobody reversed and that reverses nothing: the ledger as it stands. */
const LIVE = `m.reverses_id is null
  and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;

/* Every costed movement at this property with its unit value then and the
   running average after it - the Store's one function, so the Store and
   these reports can never price one movement two ways. */
const COSTS = `
  costs as (
    select c.movement_id, c.unit_value, c.average_after
      from stock_items i
      cross join lateral app.stock_movement_costs(i.id) c
     where i.hotel_id = $1)`;

/* Each item's cost on the date in the given parameter: the running average
   after its last costed movement that day or before. */
const costOn = (dateParam: string) => `
  cost as (
    select distinct on (m.item_id) m.item_id, c.average_after as unit_cost
      from costs c
      join stock_movements m on m.id = c.movement_id
     where m.business_date <= ${dateParam}::date
     order by m.item_id, c.movement_id desc)`;

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

/** A delivery is "near expiry" this many days before it (or after). */
const NEAR_EXPIRY_DAYS = 30;

export async function stockOnHand(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    store: string; item: string; unit: string; category: string | null;
    on_hand: string; unit_cost: string | null; value: string | null;
  }>(
    `with ${COSTS}, ${costOn("$2")},
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

  /* Deliveries whose expiry is within NEAR_EXPIRY_DAYS of the date, or
     past it, while the item is still held in that store (D27-238 6.4). */
  const { rows: expiring } = await client.query<{
    item: string; store: string; delivered: string; quantity: string; expires: string; days_left: number;
  }>(
    `select i.name as item, l.name as store, m.business_date::text as delivered,
            m.quantity::text, m.expires_on::text as expires, (m.expires_on - $2::date) as days_left
       from stock_movements m
       join stock_items i on i.id = m.item_id
       join locations l on l.id = m.location_id
      where m.hotel_id = $1 and m.kind = 'receipt' and m.expires_on is not null
        and m.business_date <= $2::date and m.expires_on <= $2::date + $3::int and ${LIVE}
        and (select coalesce(sum(h.quantity), 0) from stock_movements h
              where h.item_id = m.item_id and h.location_id = m.location_id and not h.empty
                and h.business_date <= $2::date) > 0
      order by m.expires_on, i.name`,
    [property.id, asOn, NEAR_EXPIRY_DAYS]);

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
  }, {
    key: "expiry", title: "Near expiry",
    columns: [col("item", "Item", "text"), col("store", "Store", "text"), col("delivered", "Delivered", "date"),
      col("quantity", "Quantity delivered", "ratio"), col("expires", "Expires", "date"),
      col("daysLeft", "Days left", "count")],
    rows: expiring.map((r) => row({
      item: r.item, store: r.store, delivered: r.delivered, quantity: Number(r.quantity),
      expires: r.expires, daysLeft: r.days_left,
    })),
    empty: `No delivery still held expires within ${NEAR_EXPIRY_DAYS} days.`,
    note: `Deliveries expiring within ${NEAR_EXPIRY_DAYS} days, or already past, while the item is still held in that store. A negative number has expired.`,
  });
  return doc(property, "stock-on-hand", "Closing stock", asOnFact(asOn), sections);
}

/* ── The window's live movements, each valued at its moment ──────────── */

interface Moved {
  id: string; day: string; kind: string; item: string; unit: string; store: string;
  quantity: number; value: number | null; note: string | null; by: string | null;
  outlet: string | null; outlet_id: string | null; item_id: string;
  department: string | null; broken_by: string | null;
}

/* A delivery at what was paid; anything else at the running average of its
   moment (app.stock_movement_costs). A move between stores has no value: it
   changes no total. */
async function movedIn(
  client: Client, hotelId: string, from: string, to: string, kinds: readonly string[],
): Promise<Moved[]> {
  const { rows } = await client.query<Omit<Moved, "quantity" | "value"> & { quantity: string; value: string | null }>(
    `with ${COSTS}
     select m.id::text, m.business_date::text as day, m.kind, i.name as item, i.unit, l.name as store,
            m.quantity::text, m.note, s.full_name as by, o.name as outlet, m.to_outlet::text as outlet_id,
            m.item_id::text, m.department, b.full_name as broken_by,
            round(m.quantity * c.unit_value, 2)::text as value
       from stock_movements m
       join stock_items i on i.id = m.item_id
       join locations l on l.id = m.location_id
       left join costs c on c.movement_id = m.id
       left join staff s on s.id = m.moved_by
       left join staff b on b.id = m.broken_by
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

/** Moved, grouped by a key, in first-seen order. */
const groupBy = <K>(ms: Moved[], key: (m: Moved) => K) => {
  const out = new Map<K, Moved[]>();
  for (const m of ms) out.set(key(m), [...(out.get(key(m)) ?? []), m]);
  return out;
};

/* ── 2 · Movement by day and kind ───────────────────────────────────── */

export async function stockMovements(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const ms = await movedIn(client, property.id, from, to,
    ["receipt", "issue", "wastage", "breakage", "adjustment", "return", "transfer"]);
  const days = [...new Set(ms.map((m) => m.day))];
  const KINDS = [
    ["received", "receipt", 1], ["issued", "issue", -1], ["wasted", "wastage", -1],
    ["broken", "breakage", -1], ["corrections", "adjustment", 1], ["returned", "return", -1],
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
      col("wasted", "Wasted"), col("broken", "Broken"), col("corrections", "Count corrections"),
      col("returned", "Returned"), col("movements", "Movements", "count"),
    ],
    rows: rows.length ? [...rows, total({
      day: "Total", received: sumOf("received"), issued: sumOf("issued"), wasted: sumOf("wasted"),
      broken: sumOf("broken"), corrections: sumOf("corrections"), returned: sumOf("returned"),
      movements: ms.length,
    })] : [],
    empty: "Nothing moved in the store in this window.",
    note: "Values in rupees, as recorded. A transfer between stores is counted, not valued: it changes no total.",
  }], [
    COST_NOTE,
    ...(unpriced ? [`${unpriced} movement${unpriced === 1 ? " has" : "s have"} no recorded cost and ${unpriced === 1 ? "is" : "are"} left out of the values.`] : []),
  ]);
}

/* ── 3 · Consumption per item, per outlet and per department ────────── */

/** Does the person reading hold `report` here? The Store shows till sales
    only to them (D27-238's outlet view); this report follows it. */
async function readsReports(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select (s.is_group_admin or exists (
              select 1 from staff_hotels sh
               where sh.staff_id = s.id and sh.hotel_id = $1 and sh.role = any($2::text[]))) as may
       from staff s where s.id = app.current_user_id() and s.is_active`,
    [hotelId, ROLES.filter((r) => can(r, "view", "report"))]);
  return rows[0]?.may === true;
}

export async function stockConsumption(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const ms = await movedIn(client, property.id, from, to, ["issue"]);
  const value = (list: Moved[]) => dayValue(list, -1);
  const items = [...groupBy(ms, (m) => m.item)].sort(([a], [b]) => a.localeCompare(b));
  const outlets = [...groupBy(ms, (m) => m.outlet_id ?? "")]
    .sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x[0]!.outlet!.localeCompare(y[0]!.outlet!)));
  const departments = [...groupBy(ms, (m) => m.department ?? "")]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  /* The till's sales before GST, per outlet (the POS door), and the food
     cost against them: the owner's basis is before GST (D27-242). A dash
     where the hotel has no basis, or to a reader who reads no reports. */
  const showSales = await readsReports(client, property.id);
  const { rows: [hotel] } = await client.query<{ basis: string | null }>(
    "select food_cost_basis as basis from hotels where id = $1", [property.id]);
  const sales = new Map<string, number>();
  if (showSales) {
    for (const s of await outletSales(client, property.id, from, to)) {
      sales.set(s.outletId, round2((sales.get(s.outletId) ?? 0) + s.net));
    }
  }
  const foodCost = (v: number | null, sold: number | null) =>
    hotel?.basis === "before_gst" && v !== null && sold ? pct(v, sold) : null;

  const itemValues = items.map(([, list]) => value(list));
  const outletRows = outlets.map(([id, list]) => {
    const v = value(list);
    const sold = id && showSales ? sales.get(id) ?? null : null;
    return { outlet: id ? list[0]!.outlet! : "No outlet", items: new Set(list.map((m) => m.item_id)).size,
             value: v, sales: sold, foodCost: foodCost(v, sold) };
  });
  const totalSales = showSales ? known(outletRows.map((r) => r.sales)).sum : null;
  const soldValue = known(outletRows.filter((r) => r.sales).map((r) => r.value)).sum;
  const departmentValues = departments.map(([, list]) => value(list));
  const itemsKnown = known(itemValues);

  const perGroup = (key: string, title: string, label: string, groups: [string, Moved[]][],
                    values: Array<number | null>, none: string): ReportSection => ({
    key, title,
    columns: [col(key === "departments" ? "department" : key, label, "text"),
      col("items", "Items", "count"), col("value", "Value (as recorded)")],
    rows: groups.length ? [
      ...groups.map(([name, list], i) => row({
        [key === "departments" ? "department" : key]: name || none,
        items: new Set(list.map((m) => m.item_id)).size, value: values[i]!,
      })),
      total({ [key === "departments" ? "department" : key]: "Total", items: null, value: known(values).sum }),
    ] : [],
    empty: "Nothing was issued in this window.",
  });

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
        col("value", "Value (as recorded)"), col("sales", "Till sales (before GST)"),
        col("foodCost", "Food cost (before GST)", "percent")],
      rows: outletRows.length ? [
        ...outletRows.map((r) => row(r)),
        total({ outlet: "Total", items: null, value: known(outletRows.map((r) => r.value)).sum,
                sales: totalSales, foodCost: foodCost(soldValue, totalSales) }),
      ] : [],
      empty: "Nothing was issued in this window.",
      note: showSales
        ? "No outlet: issues to housekeeping, maintenance and the rest, which have no till. Food cost: what was issued to the outlet over what its till sold, both before GST."
        : "Till sales and the food cost are for those who read the hotel's reports.",
    },
    perGroup("departments", "Per department", "Department", departments, departmentValues, "(not said)"),
  ];
  return doc(property, "stock-consumption", "Consumption", windowFacts(from, to), sections);
}

/* ── 4 · Wastage and breakage, and 5 · the count ─────────────────────── */

const listColumns = (qtyKey: string, qtyLabel: string) => [
  col("day", "Day", "date"), col("store", "Store", "text"), col("item", "Item", "text"),
  col(qtyKey, qtyLabel, "ratio"), col("unit", "Unit", "text"), col("value", "Value (as recorded)"),
  col("reason", "Reason", "text"),
];

export async function stockWastage(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const ms = await movedIn(client, property.id, from, to, ["wastage", "breakage"]);
  const section = (kind: "wastage" | "breakage"): ReportSection => {
    const mine = ms.filter((m) => m.kind === kind);
    const k = known(mine.map((m) => out(m.value)));
    const broken = kind === "breakage";
    return {
      key: kind, title: broken ? "Breakage" : "Wastage",
      columns: [...listColumns("quantity", "Quantity"),
        ...(broken ? [col("brokenBy", "Broken by", "text")] : []), col("by", "Recorded by", "text")],
      rows: mine.length ? [
        ...mine.map((m) => row({
          day: m.day, store: m.store, item: m.item, quantity: round2(-m.quantity), unit: m.unit,
          value: out(m.value), reason: m.note, ...(broken ? { brokenBy: m.broken_by } : {}), by: m.by,
        })),
        total({ day: null, store: null, item: "Total", quantity: null, unit: null, value: k.sum, reason: null,
                ...(broken ? { brokenBy: null } : {}), by: null }),
      ] : [],
      empty: broken ? "Nothing was broken in this window." : "Nothing was wasted in this window.",
      ...(leftOut(k.missing, "line") ? { note: leftOut(k.missing, "line")! } : {}),
    };
  };
  return doc(property, "stock-wastage", "Wastage and breakage", windowFacts(from, to),
    [section("wastage"), section("breakage")]);
}

export async function stockCountDifferences(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  /* The count sheet's own lines (stock_count_lines): every line counted,
     matched or not, with the book and what was found. The difference's value
     is the correction it wrote, at its moment. */
  const { rows } = await client.query<{
    day: string; store: string; item: string; unit: string; book: string; counted: string;
    value: string | null; reason: string | null; by: string | null;
  }>(
    `with ${COSTS}
     select k.business_date::text as day, l.name as store, i.name as item, i.unit,
            k.book::text, k.counted::text,
            round(m.quantity * c.unit_value, 2)::text as value, m.note as reason, s.full_name as by
       from stock_count_lines k
       join stock_items i on i.id = k.item_id
       join locations l on l.id = k.location_id
       left join stock_movements m on m.id = k.movement_id
       left join costs c on c.movement_id = k.movement_id
       left join staff s on s.id = k.counted_by
      where k.hotel_id = $1 and not k.empty and k.counted <> k.book
        and k.business_date between $2::date and $3::date
      order by k.business_date, k.counted_at, i.name`,
    [property.id, from, to]);
  const { rows: last } = await client.query<{ item: string; store: string; counted: string; by: string | null }>(
    `select distinct on (k.item_id, k.location_id)
            i.name as item, l.name as store, k.business_date::text as counted, s.full_name as by
       from stock_count_lines k
       join stock_items i on i.id = k.item_id
       join locations l on l.id = k.location_id
       left join staff s on s.id = k.counted_by
      where k.hotel_id = $1 and not k.empty and k.business_date <= $2::date
      order by k.item_id, k.location_id, k.counted_at desc`,
    [property.id, to]);
  last.sort((a, b) => a.item.localeCompare(b.item) || a.store.localeCompare(b.store));
  const k = known(rows.map((r) => num(r.value)));
  return doc(property, "stock-count-differences", "Count differences", windowFacts(from, to), [{
    key: "corrections", title: "Count corrections",
    columns: [
      col("day", "Day", "date"), col("store", "Store", "text"), col("item", "Item", "text"),
      col("book", "Book", "ratio"), col("counted", "Counted", "ratio"), col("difference", "Difference", "ratio"),
      col("unit", "Unit", "text"), col("value", "Value (as recorded)"), col("reason", "Reason", "text"),
      col("by", "Counted by", "text"),
    ],
    rows: rows.length ? [
      ...rows.map((r) => row({
        day: r.day, store: r.store, item: r.item, book: Number(r.book), counted: Number(r.counted),
        difference: round2(Number(r.counted) - Number(r.book)), unit: r.unit, value: num(r.value),
        reason: r.reason, by: r.by,
      })),
      total({ day: null, store: null, item: "Total", book: null, counted: null, difference: null, unit: null,
              value: k.sum, reason: null, by: null }),
    ] : [],
    empty: "No count found a difference in this window.",
    note: ["From the count sheet. A negative difference: less was found than the book held.",
      leftOut(k.missing, "line")].filter(Boolean).join(" "),
  }, {
    key: "last", title: "Last counted",
    columns: [col("item", "Item", "text"), col("store", "Store", "text"),
      col("counted", "Last counted", "date"), col("by", "Counted by", "text")],
    rows: last.map((r) => row({ item: r.item, store: r.store, counted: r.counted, by: r.by })),
    empty: "Nothing has been counted yet.",
  }]);
}

/* ── 6 · Dead stock: nothing went OUT for 30, 60 or 90 days (D27-240 R-3) */

export async function stockDead(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    item: string; store: string; unit: string; on_hand: string; value: string | null;
    last_out: string | null; idle: number;
  }>(
    `with ${COSTS}, ${costOn("$2")},
     held as (
       select m.item_id, m.location_id, sum(m.quantity) as on_hand,
              max(m.business_date) filter (
                where m.quantity < 0 and m.kind in ('issue', 'wastage', 'breakage', 'transfer')
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
    note: "Out means issued, wasted, broken or moved to another store. A dash under Last went out: never, since it came in.",
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
     purchase order's delivery lands too (receiveIntoStore). The supplier as
     recorded on the delivery; its price before GST, and its GST as the bill
     said it (D27-238 6.2): all three or none, none a dash. */
  const { rows } = await client.query<{
    item: string; unit: string; supplier: string | null; id: string;
    unit_cost: string | null; value: string | null; gst: string | null; claimable: boolean | null;
  }>(
    `select i.name as item, i.unit, nullif(btrim(m.supplier), '') as supplier, m.id::text,
            m.unit_cost::text, round(m.quantity * m.unit_cost, 2)::text as value,
            m.gst_amount::text as gst, m.gst_claimable as claimable
       from stock_movements m
       join stock_items i on i.id = m.item_id
      where m.hotel_id = $1 and m.kind = 'receipt' and not m.empty
        and m.business_date between $2::date and $3::date and ${LIVE}
      order by m.business_date, m.id`,
    [property.id, from, to]);

  const sumOrDash = (values: Array<number | null>) =>
    values.every((v) => v === null) ? null : known(values).sum;
  const bySupplier = new Map<string, typeof rows>();
  for (const r of rows) bySupplier.set(r.supplier ?? "", [...(bySupplier.get(r.supplier ?? "") ?? []), r]);
  const suppliers = [...bySupplier].map(([name, list]) => ({
    name, deliveries: list.length,
    value: sumOrDash(list.map((r) => num(r.value))),
    gst: sumOrDash(list.map((r) => num(r.gst))),
    claimable: sumOrDash(list.filter((r) => r.gst !== null).map((r) => (r.claimable ? Number(r.gst) : 0))),
  })).sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name)));

  const priced = rows.filter((r) => r.unit_cost !== null);
  const items = [...new Set(priced.map((r) => r.item))].sort((a, b) => a.localeCompare(b));
  const k = known(suppliers.map((s) => s.value));
  return doc(property, "supplier-spend", "Supplier spend", windowFacts(from, to), [
    {
      key: "suppliers", title: "Spend per supplier",
      columns: [col("supplier", "Supplier", "text"), col("deliveries", "Deliveries", "count"),
        col("value", "Value before GST (as recorded)"), col("gst", "GST (as recorded)"),
        col("claimable", "GST claimable")],
      rows: suppliers.length ? [
        ...suppliers.map((s) => row({
          supplier: s.name || "Not named", deliveries: s.deliveries, value: s.value, gst: s.gst, claimable: s.claimable,
        })),
        total({ supplier: "Total", deliveries: rows.length, value: k.sum,
                gst: sumOrDash(suppliers.map((s) => s.gst)), claimable: sumOrDash(suppliers.map((s) => s.claimable)) }),
      ] : [],
      empty: "No deliveries in this window.",
      note: ["GST as the supplier's bill said it, on the deliveries that recorded it; a dash where none did.",
        leftOut(k.missing, "supplier")].filter(Boolean).join(" "),
    },
    {
      key: "prices", title: "Price trend",
      columns: [col("item", "Item", "text"), col("unit", "Unit", "text"),
        col("first", "First price (before GST)"), col("last", "Last price (before GST)"),
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
