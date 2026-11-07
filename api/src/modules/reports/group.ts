import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { READ_RULES, allows, refusalFor } from "../../roleGate.ts";
import { can, type Role } from "../../permissions.ts";
import { renderPdf, renderXlsx, renderCsv } from "../../reportRender.ts";
import {
  col, row, total, pct, ratio, round2,
  type Cell, type ReportColumn, type ReportDoc, type ReportFact, type ReportRow, type ReportSection,
} from "./document.ts";
import { buildReport } from "./build.ts";
import { dailyFigures, sumDays } from "./figures.ts";
import { GRID, figuresRow, monthWindow } from "./builders/statistics.ts";

/* ══════════════════════════════════════════════════════════════════
   GROUP REPORTS - several properties in one report (D27-383 item 6)

   GET /api/group/reports/:key?hotels=5EL,SHI&asOn=  (and .pdf .xlsx .csv)

   Each property's LINE is its own report's figures: the Manager report,
   Money owed by age and the restaurant's sales are read off that
   property's own document (buildReport), the statistics from the same
   dailyFigures() and figuresRow() the one-property report is made of. So
   a line can never disagree with the property's own report.

   WHO: every property named is asked the one-property report's own rule
   (roleGate READ_RULES), with the person's role AT THAT PROPERTY, and the
   file also its `export`. One property they may not open, or may not read
   that report at, and nothing is returned: the refusal names it. A test
   hotel is never in a group report (D27-296 (11)).

   THE TOTAL ADDS LIKE WITH LIKE (decided under D27-396):
     money       only over properties in one currency - a total per currency
     tax (GST)   only over properties in one GST state (the GSTIN's first two
                 digits, else the state): across states the total's tax is a
                 dash, and each property's line keeps its own
     counts      added up
     rates       occupancy, ADR, RevPAR worked out again from the total's own
                 figures, never averaged
   A property with a figure missing shows a dash; that figure's total is a
   dash too, and the total says "incomplete" and names who is missing it.
   ══════════════════════════════════════════════════════════════════ */

export const groupReports = new Hono<{ Variables: { subject: string } }>();

export interface Hotel {
  id: string; code: string; name: string; currency: string; businessDate: string;
  /** Who is like whom for tax: the GSTIN's state code, else the state's name. */
  gst: string; state: string; role: string | null; test: boolean;
}

interface Params { asOn: string; month: string; from: string }

type Cells = Record<string, Cell>;
type Line = Record<string, Cells>;

interface Spec {
  title: string;
  /** The one-property report's read rule, asked at every property. */
  rule: string;
  orientation: "portrait" | "landscape";
  sections: (p: Params) => { key: string; title: string; columns: ReportColumn[] }[];
  /** One property's cells, by section. A key starting "_" is kept for the totals only. */
  line: (client: Client, h: Hotel, p: Params) => Promise<Line>;
  /** Worked out again for a total from the total's own figures. */
  derived?: Derived;
  facts: (p: Params) => ReportFact[];
  footnotes: string[];
  chart?: (lines: { hotel: Hotel; line: Line }[]) => NonNullable<ReportDoc["chart"]>;
}

/** One figure off a property's own document: the row whose first cell is `label`. */
const off = (doc: ReportDoc, section: string, label: string, column: string): Cell =>
  doc.sections.find((s) => s.key === section)?.rows
    .find((r) => r.kind !== "band" && r.cells["label"] === label)?.cells[column] ?? null;

const PERIODS = [["today", "Today"], ["ptd", "PTD (month to date)"], ["ytd", "YTD (year to date)"]] as const;
/** A rate, from the figures it is made of. */
type Derived = Record<string, { of: string[]; f: (t: Record<string, number>) => number }>;
/** Occupancy, ADR and RevPAR from a total's own rooms sold (`sold`: the
    Manager report's Sold Room, as each property's switches count it). */
const rates = (sold: string): Derived => ({
  occupancy: { of: [sold, "available"], f: (t) => pct(t[sold]!, t["available"]!) },
  adr: { of: ["room", sold], f: (t) => ratio(t["room"]!, t[sold]!) },
  revpar: { of: ["room", "available"], f: (t) => ratio(t["room"]!, t["available"]!) },
});
const asOnFact = (p: Params): ReportFact[] => [{ label: "As on Date", value: p.asOn, kind: "date" }];
const DASH_NOTE = "A \"-\" means the figure is not held in this system. It is not a zero.";

const MANAGER_COLUMNS = [
  col("label", "Property", "text"),
  col("available", "Available room nights", "count"),
  col("sold", "Sold Room", "count"),
  col("occupancy", "Occupancy Rate (%)", "percent"),
  col("adr", "ADR"),
  col("revpar", "RevPAR"),
  col("room", "Room Charges"),
  col("extra", "Extra Charges"),
  col("pos", "POS Revenue"),
  col("revenue", "Total Revenue"),
  col("tax", "Tax"),
  col("paid", "Total Payment"),
];

const RESTAURANT_COLUMNS = [
  col("label", "Property", "text"),
  col("net", "Total Revenue without Tax"),
  col("tax", "Tax"),
  col("gross", "Total Revenue with Tax"),
  col("paid", "Payment Total"),
];

const byPeriod = (columns: ReportColumn[]) => () =>
  PERIODS.map(([key, title]) => ({ key, title, columns }));

export const GROUP_SPECS = {
  manager: {
    title: "Manager report",
    rule: "GET /api/hotels/:code/reports/manager",
    orientation: "landscape",
    sections: byPeriod(MANAGER_COLUMNS),
    line: async (client, h, p) => {
      const doc = await buildReport(client, h.id, "manager", { asOn: p.asOn });
      return Object.fromEntries(PERIODS.map(([at]) => [at, {
        available: off(doc, "room-summary", "Total Available Room nights", at),
        sold: off(doc, "room-summary", "Sold Room", at),
        occupancy: off(doc, "statistics", "Occupancy Rate (%)", at),
        adr: off(doc, "statistics", "Average Daily Rate (ADR)", at),
        revpar: off(doc, "statistics", "Revenue Per Available Room", at),
        room: off(doc, "room-charges", "Room Charges", at),
        extra: off(doc, "extra-charges", "Total", at),
        pos: off(doc, "revenue-summary", "POS Revenue", at),
        revenue: off(doc, "revenue-summary", "Total Revenue", at),
        tax: off(doc, "tax", "Total", at),
        paid: off(doc, "payment", "Total Payment", at),
      }]));
    },
    derived: rates("sold"),
    facts: asOnFact,
    footnotes: [
      "Each property's line is its own Manager report on the same date: Today, PTD from the 1st of the month, YTD from 1 April. Its own report has every line.",
    ],
  },
  "monthly-statistics": {
    title: "Monthly statistics",
    rule: "GET /api/hotels/:code/reports/monthly-statistics",
    orientation: "landscape",
    sections: (p) => [{ key: "month", title: monthWindow(p.month).name, columns: GRID(col("label", "Property", "text")) }],
    line: async (client, h, p) => {
      const w = monthWindow(p.month);
      const f = sumDays(await dailyFigures(client, h.id, w.from, w.to));
      /* The grid's Night Sold is paying rooms; its rates divide by Sold Room. */
      return { month: { ...figuresRow(h.name, f), _sold: f.sold } };
    },
    derived: rates("_sold"),
    facts: (p) => [{ label: "Month", value: monthWindow(p.month).name, kind: "text" }],
    footnotes: [
      "Each property's line is the Total of its own Monthly statistics for the month.",
      "Occupancy and ADR count rooms sold as each property's own switches say (Settings, Front desk rules).",
      "Expense is not recorded in this system and shows \"-\".",
    ],
  },
  "room-revenue": {
    title: "Room revenue and occupancy",
    rule: "GET /api/hotels/:code/reports/monthly-occupancy",
    orientation: "landscape",
    sections: () => [{
      key: "rooms", title: "Rooms and room revenue",
      columns: [
        col("label", "Property", "text"),
        col("available", "Available room nights", "count"),
        col("sold", "Rooms sold", "count"),
        col("occupancy", "Occupancy %", "percent"),
        col("adr", "ADR"),
        col("revpar", "RevPAR"),
        col("room", "Room revenue"),
      ],
    }],
    line: async (client, h, p) => {
      const f = sumDays(await dailyFigures(client, h.id, p.from, p.asOn));
      const r = figuresRow(h.name, f);
      return { rooms: { label: h.name, available: f.available, sold: f.sold,
        occupancy: r.occupancy, adr: r.adr, revpar: r.revpar, room: f.room } };
    },
    derived: rates("sold"),
    facts: (p) => [{ label: "Date From", value: p.from, kind: "date" }, { label: "To", value: p.asOn, kind: "date" }],
    footnotes: [
      "Rooms sold, occupancy and ADR count rooms as each property's own switches say (Settings, Front desk rules): the Manager report's Sold Room.",
      "Room revenue is room charges before tax, each night's on its own night; nights not posted yet are at the booking's rate.",
    ],
    chart: (lines) => ({
      kind: "bar", title: "Occupancy by property", unit: "percent",
      x: lines.map((l) => l.hotel.name),
      series: [{ label: "Occupancy %", values: lines.map((l) => {
        const v = l.line["rooms"]!["occupancy"];
        return typeof v === "number" ? v : null;
      }) }],
    }),
  },
  "dues-by-age": {
    title: "Money owed by age",
    rule: "GET /api/hotels/:code/reports/dues-by-age",
    orientation: "landscape",
    sections: () => [{
      key: "aged", title: "Owed to each property",
      columns: [
        col("label", "Property", "text"),
        col("d30", "0-30 days"), col("d60", "31-60 days"), col("d90", "61-90 days"),
        col("over90", "Over 90 days"), col("ahead", "Paid ahead"), col("total", "Total owed"),
      ],
    }],
    line: async (client, h, p) => {
      const doc = await buildReport(client, h.id, "dues-by-age", { asOn: p.asOn });
      /* Nothing owed is a real nought here: the property's own report says
         "No company, agent or booking site owed anything on this date." */
      const at = (k: string) => off(doc, "aged", "Total owed", k) ?? 0;
      return { aged: { label: h.name, d30: at("d30"), d60: at("d60"), d90: at("d90"),
        over90: at("over90"), ahead: at("ahead"), total: at("total") } };
    },
    facts: asOnFact,
    footnotes: [
      "Each property's line is the Total owed of its own Money owed by age on the same date: what companies, agents and booking sites owe it.",
    ],
  },
  "restaurant-sales": {
    title: "Restaurant sales",
    rule: "GET /api/hotels/:code/reports/manager",
    orientation: "portrait",
    sections: byPeriod(RESTAURANT_COLUMNS),
    line: async (client, h, p) => {
      const doc = await buildReport(client, h.id, "manager", { asOn: p.asOn });
      return Object.fromEntries(PERIODS.map(([at]) => {
        const net = off(doc, "pos-summary", "All Outlet's Total Revenue without Tax", at);
        const gross = off(doc, "pos-summary", "All Outlet's Total Revenue with Tax", at);
        return [at, {
          net, gross,
          tax: typeof net === "number" && typeof gross === "number" ? round2(gross - net) : null,
          paid: off(doc, "pos-payment-summary", "All Outlet's Payment Total", at),
        }];
      }));
    },
    facts: asOnFact,
    footnotes: [
      "Each property's line is the POS Summary of its own Manager report on the same date, every outlet added up: settled bills, a bill charged to a room included.",
      "Tax is the restaurant's GST and the bar's VAT.",
    ],
  },
} satisfies Record<string, Spec>;

export type GroupKey = keyof typeof GROUP_SPECS;
export const GROUP_KEYS = Object.keys(GROUP_SPECS) as GroupKey[];

/* ── The total: like with like ─────────────────────────────────────── */

const TAX = new Set(["tax"]);
const stateName = (h: Hotel) => h.state || (h.gst.startsWith("gstin:") ? `GST state ${h.gst.slice(6)}` : "state not set");

/** Each property's rows, then a total per currency. Returns the notes it owes the footnotes. */
export function lineUp(
  columns: ReportColumn[], lines: { hotel: Hotel; cells: Cells }[], derived: Spec["derived"] = {},
): { rows: ReportRow[]; notes: string[] } {
  const keys = columns.filter((c) => c.kind !== "text").map((c) => c.key);
  const hidden = [...new Set(lines.flatMap((l) => Object.keys(l.cells).filter((k) => k.startsWith("_"))))];
  const shown = (cells: Cells) => Object.fromEntries(columns.map((c) => [c.key, cells[c.key] ?? null]));
  const rows = lines.map((l) => row({ ...shown(l.cells), label: l.hotel.name }));
  const notes: string[] = [];
  const currencies = [...new Set(lines.map((l) => l.hotel.currency))];

  for (const currency of currencies) {
    const mine = lines.filter((l) => l.hotel.currency === currency);
    const states = [...new Set(mine.map((l) => l.hotel.gst))];
    const sums: Record<string, number> = {};
    const cells: Cells = {};
    const missing: string[] = [];
    for (const k of [...keys, ...hidden]) {
      if (derived[k]) continue;
      if (TAX.has(k) && states.length > 1) { cells[k] = null; continue; }
      const values = mine.map((l) => l.cells[k] ?? null);
      if (values.every((v) => v === null)) { cells[k] = null; continue; }
      const gaps = mine.filter((l) => typeof l.cells[k] !== "number");
      if (gaps.length) {
        cells[k] = null;
        const name = columns.find((c) => c.key === k)?.label ?? k;
        missing.push(`${gaps.map((l) => l.hotel.name).join(" and ")} ${gaps.length === 1 ? "has" : "have"} no ${name}`);
        continue;
      }
      cells[k] = sums[k] = round2((values as number[]).reduce((t, v) => t + v, 0));
    }
    /* A rate needs every figure it is made of: one missing, a dash. */
    for (const [k, d] of Object.entries(derived)) {
      cells[k] = d.of.every((i) => typeof sums[i] === "number") ? d.f(sums) : null;
    }
    const label = `${currencies.length > 1 ? `Total, ${currency}` : "Total"}${missing.length ? " - incomplete" : ""}`;
    rows.push(total({ ...shown(cells), label }));
    if (missing.length) notes.push(`${label}: ${missing.join("; ")}.`);
    if (states.length > 1 && keys.some((k) => TAX.has(k))) {
      const names = [...new Set(mine.map((l) => stateName(l.hotel)))].join(", ");
      notes.push(`Tax is not added across GST states (${names}): each state's GST is filed under its own GSTIN. Each property's line shows its own.`);
    }
  }
  if (currencies.length > 1) {
    notes.push(`The properties keep money in ${currencies.join(", ")}: money is never added across currencies, so each has its own total.`);
  }
  return { rows, notes };
}

/* ── Asking, and answering ─────────────────────────────────────────── */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9]{2,10}$/;

type Built = { status: 200; doc: ReportDoc; by: { name: string; at: Date; timezone: string } }
  | { status: 400 | 403 | 404; error: string };

async function build(subject: string, key: string, q: Record<string, string>, file: boolean): Promise<Built> {
  if (!Object.hasOwn(GROUP_SPECS, key)) return { status: 404, error: "No such group report." };
  const spec: Spec = GROUP_SPECS[key as GroupKey];
  const codes = [...new Set((q["hotels"] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) return { status: 400, error: "Choose at least one property." };
  if (codes.some((c) => !CODE.test(c))) return { status: 400, error: "A property is named by its code, such as 5EL." };
  for (const [name, re, say] of [["asOn", ISO, "The date"], ["from", ISO, "The first date"]] as const) {
    if (q[name] !== undefined && !re.test(q[name]!)) return { status: 400, error: `${say} must be written YYYY-MM-DD.` };
  }
  if (q["month"] !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(q["month"])) {
    return { status: 400, error: "The month must be written YYYY-MM." };
  }

  return withSession(subject, async (client, session) => {
    const { rows } = await client.query<{
      id: string; code: string; name: string; currency: string; bd: string;
      gst: string; state: string | null; role: string | null; test: boolean;
    }>(
      `select h.id::text, h.code, h.name, btrim(h.currency) as currency,
              to_char(app.business_date(h.id), 'YYYY-MM-DD') as bd,
              coalesce('gstin:' || substr(nullif(btrim(h.gstin), ''), 1, 2),
                       'state:' || lower(nullif(btrim(h.state), '')), 'none:' || h.code) as gst,
              nullif(btrim(h.state), '') as state,
              case when $2 then 'owner' else sh.role end as role,
              h.test_of is not null as test
         from hotels h
         left join staff_hotels sh on sh.hotel_id = h.id and sh.staff_id = $1
        where h.code = any($3) and h.is_active`,
      [session.staffId, session.isGroupAdmin, codes]);
    const found = new Map(rows.map((r) => [r.code, r]));
    const rule = READ_RULES[spec.rule]!;
    const hotels: Hotel[] = [];
    for (const code of codes) {
      const h = found.get(code);
      /* Not rostered there, or no such property: the same words, so a
         refusal never says which properties exist. */
      if (!h || h.role === null) return { status: 403 as const, error: `${code} is not a property you work at, so its figures are not shown.` };
      if (h.test) return { status: 403 as const, error: `${h.name} is a test hotel: a group report adds up real hotels only.` };
      if (!allows(rule, h.role as Role)) return { status: 403 as const, error: `At ${h.name}: ${refusalFor(rule)}` };
      if (file && !can(h.role as Role, "export", "report")) {
        return { status: 403 as const, error: `At ${h.name}: downloading reports is for the owner, an administrator, the general manager, the hotel manager, the revenue manager or the accountant. Ask one of them.` };
      }
      hotels.push({ id: h.id, code: h.code, name: h.name, currency: h.currency, businessDate: h.bd,
        gst: h.gst, state: h.state ?? "", role: h.role, test: h.test });
    }

    /* No date asked: the earliest business date of the properties chosen,
       so no property is reported past its own day (decided under D27-396). */
    const asOn = q["asOn"] ?? hotels.map((h) => h.businessDate).sort()[0]!;
    const p: Params = { asOn, month: q["month"] ?? asOn.slice(0, 7), from: q["from"] ?? `${asOn.slice(0, 7)}-01` };
    if (p.from > p.asOn) return { status: 400 as const, error: "The first date must be on or before the last." };

    /* One property at a time: one connection, one transaction, one answer. */
    const lines: { hotel: Hotel; line: Line }[] = [];
    for (const h of hotels) lines.push({ hotel: h, line: await spec.line(client, h, p) });

    const notes: string[] = [];
    const sections: ReportSection[] = spec.sections(p).map((s) => {
      const made = lineUp(s.columns, lines.map((l) => ({ hotel: l.hotel, cells: l.line[s.key] ?? {} })), spec.derived);
      for (const n of made.notes) if (!notes.includes(n)) notes.push(n);
      return { key: s.key, title: s.title, columns: s.columns, rows: made.rows };
    });

    const { rows: group } = await client.query<{ name: string | null }>(
      "select (select name from group_settings limit 1) as name");
    const currencies = [...new Set(hotels.map((h) => h.currency))];
    const doc: ReportDoc = {
      report: `group-${key}`,
      title: spec.title,
      property: { code: "GROUP", name: group[0]?.name ?? "All properties", address: null, gstin: null },
      orientation: spec.orientation,
      facts: [
        { label: "Properties", value: hotels.map((h) => h.name).join(", "), kind: "text" },
        ...spec.facts(p),
        { label: "Currency", value: currencies.join(", "), kind: "text" },
      ],
      sections,
      ...(spec.chart ? { chart: spec.chart(lines) } : {}),
      footnotes: [
        ...spec.footnotes,
        "A total adds up only like with like: money in one currency, tax within one GST state, and rates worked out again from the totals, never averaged.",
        ...notes,
        DASH_NOTE,
      ],
    };
    return { status: 200 as const, doc, by: { name: session.fullName, at: new Date(), timezone: "Asia/Kolkata" } };
  });
}

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

/* The file route first: `:key` alone would answer "manager.pdf" too. */
groupReports.get("/group/reports/:file{[a-z0-9-]+\\.(?:pdf|xlsx|csv)}", async (c) => {
  const [, key, ext] = /^([a-z0-9-]+)\.(pdf|xlsx|csv)$/.exec(c.req.param("file")) as unknown as [string, string, keyof typeof TYPES];
  const made = await build(c.get("subject"), key, c.req.query(), true);
  if (made.status !== 200) return c.json({ error: made.error }, made.status);
  const body = ext === "pdf" ? await renderPdf(made.doc, made.by)
    : ext === "xlsx" ? await renderXlsx(made.doc, made.by)
    : Buffer.from(renderCsv(made.doc, made.by), "utf-8");
  const period = c.req.query("month") ?? made.doc.facts.find((f) => f.kind === "date" && f.label !== "Date From")?.value ?? "";
  return c.body(new Uint8Array(body), 200, {
    "Content-Type": TYPES[ext],
    "Content-Disposition": `attachment; filename="GROUP-${key}-${period}.${ext}"`,
    "Cache-Control": "no-store",
  });
});

groupReports.get("/group/reports/:key", async (c) => {
  const made = await build(c.get("subject"), c.req.param("key"), c.req.query(), false);
  if (made.status !== 200) return c.json({ error: made.error }, made.status);
  return c.json(made.doc);
});
