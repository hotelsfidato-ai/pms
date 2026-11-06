import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { BUILT_KEYS, buildReport, paramsProblem, switchedOff } from "./build.ts";
import { BAR_STOCK_OFF } from "../stores/index.ts";
import { propertyFor, isoDateParam } from "./figures.ts";
import { gstr1Data, gstr1Json } from "./builders/gst.ts";
import type { ReportParams } from "./document.ts";

/* ══════════════════════════════════════════════════════════════════
   GET /:code/reports/<key> — a report, as the screen draws it

   One route per report, each spelled out rather than one `:key` route,
   so the master's `/:code/reports/<key>.pdf` (and .xlsx, .csv) can
   never be answered here by mistake.

   Every parameter is optional and checked: as on the property's
   business date, in its month and its year. A malformed one is refused
   in a sentence, never guessed at.
   ══════════════════════════════════════════════════════════════════ */

export const documents = new Hono<{ Variables: { subject: string } }>();

for (const key of BUILT_KEYS) {
  documents.get(`/:code/reports/${key}`, async (c) => {
    const q = c.req.query();
    const asOn = q["asOn"] === undefined ? undefined : isoDateParam(q["asOn"]);
    if (asOn === null) return c.json({ error: "The date must be written YYYY-MM-DD." }, 400);
    if (q["month"] !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(q["month"])) {
      return c.json({ error: "The month must be written YYYY-MM." }, 400);
    }
    if (q["year"] !== undefined && !/^\d{4}$/.test(q["year"])) {
      return c.json({ error: "The year must be four digits." }, 400);
    }
    const from = q["from"] === undefined ? undefined : isoDateParam(q["from"]);
    if (from === null) return c.json({ error: "The first date must be written YYYY-MM-DD." }, 400);
    const missing = paramsProblem(key, q["supplier"], q["account"]);
    if (missing) return c.json({ error: missing }, 400);

    const doc = await withSession(c.get("subject"), async (client) => {
      const property = await propertyFor(client, c.req.param("code"));
      if (!property) return null;
      const params: ReportParams = {
        asOn: asOn ?? property.businessDate,
        ...(q["month"] ? { month: q["month"] } : {}),
        ...(q["year"] ? { year: Number(q["year"]) } : {}),
        ...(from ? { from } : {}),
        ...(q["ignoreZero"] !== undefined ? { ignoreZero: q["ignoreZero"] === "1" } : {}),
        ...(q["supplier"] ? { supplier: q["supplier"] } : {}),
        ...(q["account"] ? { account: q["account"] } : {}),
      };
      if (await switchedOff(client, property.id, key)) return "off" as const;
      return buildReport(client, property.id, key, params);
    });

    if (doc === "off") return c.json({ error: BAR_STOCK_OFF }, 403);
    return doc ? c.json(doc) : c.json({ error: "No such property." }, 404);
  });
}

/* ══════════════════════════════════════════════════════════════════
   GET /:code/reports/gstr-1.json?month=YYYY-MM — the GSTR-1 file
   (D27-383 item 4)

   The GST Returns Offline Tool's JSON for one GSTIN and month, from the
   same figures the GSTR-1 screen draws (gstr1Data), so the file and the
   screen cannot differ. Refused, in sentences, while anything on the
   screen's "To put right" list stands: a file that does not match the
   invoices issued is worse than no file. Who: roleGate (`report` export).
   ══════════════════════════════════════════════════════════════════ */
documents.get("/:code/reports/gstr-1.json", async (c) => {
  const month = c.req.query("month");
  if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return c.json({ error: "The month must be written YYYY-MM." }, 400);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return null;
    return { property, data: await gstr1Data(client, property, month ?? property.businessDate.slice(0, 7)) };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  const { property, data } = result;
  if (data.problems.length) {
    return c.json({ error: `The GSTR-1 file was not made. ${data.problems.join(" ")}`, problems: data.problems }, 409);
  }
  return c.body(JSON.stringify(gstr1Json(data)), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${property.code}-GSTR1-${data.gstin}-${data.month}.json"`,
    "Cache-Control": "no-store",
  });
});
