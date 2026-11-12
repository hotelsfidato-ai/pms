import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { ROLES, type Role } from "../../permissions.ts";
import { READ_RULES, allows, refusalFor } from "../../roleGate.ts";
import { renderPdf, renderXlsx } from "../../reportRender.ts";
import { heading, propertyFor } from "./figures.ts";
import type { Cell, CellKind, ReportDoc } from "./document.ts";
import {
  EXPORT_KINDS, LIST_SCREENS, MAX_EXPORT_ROWS, exportRefusal, maskId, namesAnId, whoOf,
  type ExportKind, type ListScreen, type ListScreenKey,
} from "./listExports.ts";
import { SEE as DEPOSIT_READERS } from "../finance/deposits.ts";
import { DESK, teamsFor } from "../guest-services/requests.ts";
import { LOST_LOGGERS } from "../guest-services/wakeAndLost.ts";
import { VIEW_ROLES as MESSAGE_READERS } from "../guest-messaging/messages.ts";
import { VIEW_ROLES as REVIEW_READERS } from "../reputation/reputation.ts";
import { FEEDBACK_ROLES } from "../reputation/feedbackRoles.ts";
import { DESK_ROLES } from "../../routes/guestDoorKit.ts";
import { STOCK_ROLES } from "../stores/stockGrants.ts";
import { VIEW_ROLES as PURCHASING_READERS } from "../purchasing/purchasingGrants.ts";
import { SPA_READ_ROLES } from "../spa/spa.ts";
import { EQUIPMENT_GRANTS } from "../equipment/grants.ts";

/* ══════════════════════════════════════════════════════════════════
   POST /api/hotels/:code/exports/<screen>.(pdf|xlsx) - a list as a file
   (D27-383 item 1; which screens and who: listExports.ts)

   The body is what the screen shows: its columns, every row its filters,
   search, sort and period leave (not only those in view), and those
   filters as words. The hotel's name, the screen's name, who and when are
   the server's - from the database and the session, never the body.

   WHO: the person must work at THIS hotel (another hotel's address answers
   "No such property", as every route does); their role must pass the read
   rule of the route the screen's rows come from; a list of money or of
   guests' details also needs the reports' download right.

   NOT RECORDED: a report's download is not recorded either (routes/
   reportFiles.ts), and an export is one.

   ponytail: the rows come from the screen, which read them through its own
   routes under row security and roleGate; this route cannot re-prove each
   row. A forged body makes a file that names its maker. An "own" read rule
   is asked here through OWN_READERS, the role list its own route asks.
   ══════════════════════════════════════════════════════════════════ */

/* A screen whose read rule is `own` - its route asks a list of its own -
   is asked that same list here (D27-383 item 1, second part): an `own`
   rule lets everybody past the gate, and the file must not. Each line is
   the list the screen's GET route asks; api/test/listFiles.test.ts fails
   when an `own` screen has none. */
export const OWN_READERS: Partial<Record<ListScreenKey, readonly string[]>> = {
  "cash-deposits": DEPOSIT_READERS,
  "wake-up-calls": DESK,
  "lost-property": LOST_LOGGERS,
  "guest-messages": MESSAGE_READERS,
  "reviews": REVIEW_READERS,
  "feedback": FEEDBACK_ROLES,
  "online-checkin": DESK_ROLES,
  "store": STOCK_ROLES.view,
  "kitchen-stock": STOCK_ROLES.view,
  "purchasing": PURCHASING_READERS,
  "spa-diary": SPA_READ_ROLES,
  "spa-treatments": SPA_READ_ROLES,
  "equipment": EQUIPMENT_GRANTS.view,
  /* A team sees its own requests; the desk every team's. */
  "requests": ROLES.filter((r) => teamsFor(r).length > 0),
};

export const listFiles = new Hono<{ Variables: { subject: string } }>();

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

interface Body {
  columns: Array<{ label: string; kind: ExportKind }>;
  rows: Cell[][];
  facts: Array<{ label: string; value: string }>;
}

const text = (v: unknown, most: number): v is string => typeof v === "string" && v.length <= most;

/** The body, or the sentence saying what is wrong with it. */
export function readBody(raw: unknown): Body | string {
  const b = raw as Partial<Record<keyof Body, unknown>> | null;
  if (!b || typeof b !== "object") return "Send the list as JSON.";
  const { columns, rows, facts = [] } = b;
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 60) {
    return "A list has between 1 and 60 columns.";
  }
  for (const c of columns as Array<Record<string, unknown>>) {
    if (!c || !text(c["label"], 120) || !EXPORT_KINDS.includes(c["kind"] as ExportKind)) {
      return "Each column needs a heading and one of the known kinds.";
    }
  }
  if (!Array.isArray(rows)) return "Send the rows as a list.";
  if (rows.length > MAX_EXPORT_ROWS) {
    return `A file holds at most ${MAX_EXPORT_ROWS.toLocaleString("en-IN")} rows. Narrow the list first.`;
  }
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== columns.length) return "Every row needs one value per column.";
    for (const v of r) {
      if (!(v === null || (typeof v === "number" && Number.isFinite(v)) || text(v, 2000))) {
        return "A value is a number, a short text or empty.";
      }
    }
  }
  if (!Array.isArray(facts) || facts.length > 20) return "At most 20 filters describe a list.";
  for (const f of facts as Array<Record<string, unknown>>) {
    if (!f || !text(f["label"], 80) || !text(f["value"], 300)) return "Each filter needs a name and a value.";
  }
  return b as Body;
}

/** The document the renderer draws: one section, the screen's columns. A
    guest's ID number keeps its last four characters only. */
export function listDoc(screen: ListScreen, property: ReportDoc["property"], body: Body): ReportDoc {
  const masked = body.columns.map((c) => c.kind === "id" || namesAnId(c.label));
  const kind = (k: ExportKind): CellKind => (k === "money" ? "rupees" : k === "id" ? "text" : k);
  const money = body.columns.some((c) => c.kind === "money");
  return {
    report: "list",
    title: screen.title,
    property,
    orientation: body.columns.length > 6 ? "landscape" : "portrait",
    facts: [
      ...body.facts.map((f) => ({ label: f.label, value: f.value, kind: "text" as const })),
      { label: "Rows", value: body.rows.length, kind: "count" },
      ...(money ? [{ label: "Currency", value: "INR", kind: "text" as const }] : []),
    ],
    sections: [{
      key: "list",
      title: "As on the screen",
      columns: body.columns.map((c, i) => ({ key: `c${i}`, label: c.label, kind: kind(c.kind) })),
      rows: body.rows.map((r) => ({
        kind: "row" as const,
        cells: Object.fromEntries(r.map((v, i) => [`c${i}`, masked[i] && typeof v === "string" ? maskId(v) : v])),
      })),
      empty: "Nothing on the screen matched.",
    }],
    footnotes: masked.some(Boolean) ? ["ID numbers show their last four characters only."] : [],
  };
}

listFiles.post("/:code/exports/:file{[a-z0-9-]+\\.(?:pdf|xlsx)}", async (c) => {
  const [, key, ext] = /^([a-z0-9-]+)\.(pdf|xlsx)$/.exec(c.req.param("file")) as unknown as [string, string, "pdf" | "xlsx"];
  const screen = (LIST_SCREENS as Record<string, ListScreen>)[key];
  if (!screen) return c.json({ error: "No such list." }, 404);
  const body = readBody(await c.req.json().catch(() => null));
  if (typeof body === "string") return c.json({ error: body }, 400);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const property = await propertyFor(client, c.req.param("code"));
    const { rows } = property && !session.isGroupAdmin
      ? await client.query<{ role: Role }>(
          "select role from staff_hotels where staff_id = $1 and hotel_id = $2", [session.staffId, property.id])
      : { rows: [] };
    const role: Role | undefined = session.isGroupAdmin ? "owner" : rows[0]?.role;
    if (!property || !role) return { status: 404 as const, error: "No such property." };

    const rule = READ_RULES[screen.read];
    if (!rule) throw new Error(`listExports.ts: ${screen.read} is not a READ_RULES key`);
    if (!allows(rule, role)) return { status: 403 as const, error: refusalFor(rule) };
    if (rule.kind === "own") {
      const roles = OWN_READERS[key as ListScreenKey];
      if (!roles) throw new Error(`listFiles.ts: ${key} has an own read rule and no OWN_READERS line`);
      if (!roles.includes(role)) {
        return { status: 403 as const, error: `The ${screen.title.toLowerCase()} is for ${whoOf(roles)}. Ask one of them.` };
      }
    }
    const refused = exportRefusal(role, screen);
    if (refused) return { status: 403 as const, error: refused };

    return {
      status: 200 as const,
      doc: listDoc(screen, heading(property), body),
      by: { name: session.fullName, at: new Date(), timezone: property.timezone },
      filename: `${property.code}-${key}-${property.businessDate}.${ext}`,
    };
  });
  if (result.status !== 200) return c.json({ error: result.error }, result.status);

  const file = ext === "pdf" ? await renderPdf(result.doc, result.by) : await renderXlsx(result.doc, result.by);
  return c.body(new Uint8Array(file), 200, {
    "Content-Type": TYPES[ext],
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "Cache-Control": "no-store",
  });
});
