import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import * as reportsService from "../modules/reports/index.ts";
import type { ReportDoc } from "../reportDoc.ts";
import { renderPdf, renderXlsx, renderCsv } from "../reportRender.ts";

/* ══════════════════════════════════════════════════════════════════
   A REPORT AS A FILE — GET /api/hotels/:code/reports/:key.(pdf|xlsx|csv)

   The owner's D17-31 and D17-32: every report as a PDF made on the server,
   a real .xlsx and a CSV. The reports service builds the document
   (`buildReport`, exported by its front door); this route checks who is
   asking, builds it under their own session — so row level security
   decides what it holds — and renders it.

   Until the reports service exports `buildReport`, every download answers
   that reports cannot be downloaded yet, rather than a file of nothing.

   WHO: downloading is the `report` grant's `export` (src/lib/permissions.ts).
   A copy of that list is below, held to the matrix by
   api/test/reportFiles.test.ts.
   ══════════════════════════════════════════════════════════════════ */

export const reportFiles = new Hono<{ Variables: { subject: string } }>();

/** The roles holding `export` on `report`, and the owner. A COPY — see above. */
export const REPORT_EXPORTERS: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "revenue_manager", "finance",
];

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

type Builder = (
  client: Client, hotelId: string, key: string,
  params: { asOn: string; month?: string; year?: number },
) => Promise<ReportDoc>;

/* The file name is held to its pattern IN THE PATH, not inside the handler.
   Mounted on /api/hotels beside the reports service, a bare `:file` would
   answer /reports/manager itself (17 September: fourteen reports tests got
   this route's 404 instead of their report). */
reportFiles.get("/:code/reports/:file{[a-z0-9-]+\\.(?:pdf|xlsx|csv)}", async (c) => {
  const match = /^([a-z0-9-]+)\.(pdf|xlsx|csv)$/.exec(c.req.param("file"));
  if (!match) return c.json({ error: "No such report." }, 404);
  const [, key, ext] = match as unknown as [string, string, keyof typeof TYPES];

  const build = (reportsService as Record<string, unknown>)["buildReport"];
  if (typeof build !== "function") {
    return c.json({ error: "Reports cannot be downloaded yet." }, 404);
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
      [hotel.id, REPORT_EXPORTERS]);
    if (!me[0]?.may) {
      return {
        status: 403 as const,
        error: "Downloading reports is for the owner, an administrator, the general manager, "
          + "the hotel manager, the revenue manager or the accountant. Ask one of them.",
      };
    }

    const asOn = c.req.query("asOn") ?? await businessDateFor(client, hotel.id);
    const month = c.req.query("month");
    const yearParam = c.req.query("year");
    let doc: ReportDoc;
    try {
      doc = await (build as Builder)(client, hotel.id, key, {
        asOn, ...(month ? { month } : {}), ...(yearParam ? { year: Number(yearParam) } : {}),
      });
    } catch {
      return { status: 404 as const, error: "No such report." };
    }
    return { status: 200 as const, doc, by: { name: me[0].name, at: new Date(), timezone: hotel.timezone }, asOn };
  });

  if (result.status !== 200) return c.json({ error: result.error }, result.status);

  const filename = `${c.req.param("code").toUpperCase()}-${key}-${result.asOn}.${ext}`;
  const body = ext === "pdf" ? await renderPdf(result.doc, result.by)
    : ext === "xlsx" ? await renderXlsx(result.doc, result.by)
    : Buffer.from(renderCsv(result.doc, result.by), "utf-8");

  return c.body(new Uint8Array(body), 200, {
    "Content-Type": TYPES[ext],
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
});
