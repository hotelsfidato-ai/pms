import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import { can, type Role } from "../permissions.ts";
import {
  buildReport, BUILT_KEYS, REPORT_KEYS, STORE_REPORT_KEYS, type ReportParams,
} from "../modules/reports/index.ts";
import { renderPdf, renderXlsx, renderCsv } from "../reportRender.ts";

/* ══════════════════════════════════════════════════════════════════
   A REPORT AS A FILE - GET /api/hotels/:code/reports/:key.(pdf|xlsx|csv)

   The owner's D17-31 and D17-32: every report as a PDF made on the server,
   a real .xlsx and a CSV. The reports service builds the document
   (`buildReport`, exported by its front door); this route checks who is
   asking, builds it under their own session, so row level security
   decides what it holds, and renders it.

   The same parameters as the screen's route (reports/documents.ts): asOn,
   month, year, from, ignoreZero. A malformed one is refused in a sentence.

   WHO: downloading is the `report` grant's `export` (src/lib/permissions.ts).
   A copy of that list is below, held to the matrix by
   api/test/reportFiles.test.ts.
   ══════════════════════════════════════════════════════════════════ */

export const reportFiles = new Hono<{ Variables: { subject: string } }>();

/** The roles holding `export` on `report`, and the owner. A COPY - see above. */
export const REPORT_EXPORTERS: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "revenue_manager", "finance",
];

/* Money owed, which the screen's own read asks `invoice` view of (roleGate
   MONEY_REPORT; the owner's D27-147: not the revenue manager). The file
   asks the same, so the download is no way round the screen. */
const MONEY_REPORTS: readonly string[] = ["city-ledger"];

/* The Store and equipment reports (phase 3A; the owner's D27-240): read by
   their own readers (roleGate STORE_REPORTS), downloaded by those of them
   who hold the Store's export. A COPY of that list, held to the matrix by
   api/test/reportFiles.test.ts. */
export const STORE_EXPORTERS: readonly string[] = ["owner", "admin", "gm", "stores", "finance"];
const isStoreReport = (key: string) => (STORE_REPORT_KEYS as readonly string[]).includes(key);

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* The file name is held to its pattern IN THE PATH, not inside the handler.
   Mounted on /api/hotels beside the reports service, a bare `:file` would
   answer /reports/manager itself (17 September: fourteen reports tests got
   this route's 404 instead of their report). */
reportFiles.get("/:code/reports/:file{[a-z0-9-]+\\.(?:pdf|xlsx|csv)}", async (c) => {
  const match = /^([a-z0-9-]+)\.(pdf|xlsx|csv)$/.exec(c.req.param("file"));
  if (!match) return c.json({ error: "No such report." }, 404);
  const [, key, ext] = match as unknown as [string, string, keyof typeof TYPES];

  if (!(REPORT_KEYS as readonly string[]).includes(key)) {
    return c.json({ error: "No such report." }, 404);
  }
  if (!(BUILT_KEYS as readonly string[]).includes(key)) {
    return c.json({ error: "This report cannot be downloaded yet." }, 404);
  }

  const q = c.req.query();
  if (q["asOn"] !== undefined && !ISO_DATE.test(q["asOn"])) {
    return c.json({ error: "The date must be written YYYY-MM-DD." }, 400);
  }
  if (q["month"] !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(q["month"])) {
    return c.json({ error: "The month must be written YYYY-MM." }, 400);
  }
  if (q["year"] !== undefined && !/^\d{4}$/.test(q["year"])) {
    return c.json({ error: "The year must be four digits." }, 400);
  }
  if (q["from"] !== undefined && !ISO_DATE.test(q["from"])) {
    return c.json({ error: "The first date must be written YYYY-MM-DD." }, 400);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const { rows: hotels } = await client.query<{ id: string; timezone: string }>(
      "select id::text, timezone from hotels where code = $1", [c.req.param("code").toUpperCase()]);
    const hotel = hotels[0];
    if (!hotel) return { status: 404 as const, error: "No such property." };

    const { rows: me } = await client.query<{ name: string; may: boolean }>(
      `select s.full_name as name,
              (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.hotel_id = $1 and sh.role = any($2::text[])
              )) as may
         from staff s where s.id = app.current_user_id() and s.is_active`,
      [hotel.id, isStoreReport(key) ? STORE_EXPORTERS
        : MONEY_REPORTS.includes(key)
          ? REPORT_EXPORTERS.filter((r) => can(r as Role, "view", "invoice"))
          : REPORT_EXPORTERS]);
    if (!me[0]?.may) {
      return {
        status: 403 as const,
        error: isStoreReport(key)
          ? "Downloading the store's reports is for the owner, an administrator, the general manager, "
            + "the Inventory Manager or the accountant. Ask one of them."
          : MONEY_REPORTS.includes(key)
          ? "Downloading this report is for the owner, an administrator, the general manager, "
            + "the hotel manager or the accountant. Ask one of them."
          : "Downloading reports is for the owner, an administrator, the general manager, "
            + "the hotel manager, the revenue manager or the accountant. Ask one of them.",
      };
    }

    const params: ReportParams = {
      asOn: q["asOn"] ?? await businessDateFor(client, hotel.id),
      ...(q["month"] ? { month: q["month"] } : {}),
      ...(q["year"] ? { year: Number(q["year"]) } : {}),
      ...(q["from"] ? { from: q["from"] } : {}),
      ...(q["ignoreZero"] !== undefined ? { ignoreZero: q["ignoreZero"] === "1" } : {}),
    };
    /* A builder that fails is a fault, not "no such report": it is left to
       throw, so the server's error handler answers it and it is logged. */
    const doc = await buildReport(client, hotel.id, key, params);
    return {
      status: 200 as const, doc, params,
      by: { name: me[0].name, at: new Date(), timezone: hotel.timezone },
    };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);

  const { params } = result;
  const period = params.month ?? (params.year ? String(params.year) : params.asOn);
  const filename = `${c.req.param("code").toUpperCase()}-${key}-${period}.${ext}`;
  const body = ext === "pdf" ? await renderPdf(result.doc, result.by)
    : ext === "xlsx" ? await renderXlsx(result.doc, result.by)
    : Buffer.from(renderCsv(result.doc, result.by), "utf-8");

  return c.body(new Uint8Array(body), 200, {
    "Content-Type": TYPES[ext],
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
});
