import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { BUILT_KEYS, buildReport, paramsProblem, switchedOff } from "./build.ts";
import { BAR_STOCK_OFF } from "../stores/index.ts";
import { propertyFor, isoDateParam } from "./figures.ts";
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
    const missing = paramsProblem(key, q["supplier"]);
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
      };
      if (await switchedOff(client, property.id, key)) return "off" as const;
      return buildReport(client, property.id, key, params);
    });

    if (doc === "off") return c.json({ error: BAR_STOCK_OFF }, 403);
    return doc ? c.json(doc) : c.json({ error: "No such property." }, 404);
  });
}
