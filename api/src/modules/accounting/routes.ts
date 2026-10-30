import { Hono, type Context } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { propertyFor, isoDateParam, type Property } from "../reports/index.ts";
import { dayBook, dayBookXlsx, NoRoomRate } from "./dayBook.ts";
import { ledgerNames, namesProblem, saveLedgerNames } from "./ledgers.ts";
import { tallyVouchers, tallyXml, TallyRefused, type TallyVersion } from "./tally.ts";

/* ══════════════════════════════════════════════════════════════════
   GET /:code/accounting/day-book?from=&to=
   GET /:code/accounting/day-book.xlsx?from=&to=
   GET /:code/accounting/tally-prime.xml?from=&to=
   GET /:code/accounting/tally-erp9.xml?from=&to=
   GET, PUT /:code/accounting/tally-ledgers

   The day book answers as an object - the days, the totals and the days
   the night audit has not closed - and the screen both DRAWS and SAVES
   that same object, so the figures on the screen and the figures in the
   file are not two things that have to be kept in step.

   The two Tally files are built here, not in the browser: escaping and
   the property's own date belong in the API suite, which runs in UTC.
   ══════════════════════════════════════════════════════════════════ */

/** The owner, an administrator and the general manager, and nobody
    else. This is the brief's line, and `src/lib/permissions.ts` - the
    master's file - already grants those three everything the ledgers
    need, so no new resource was invented to say it. The menu hides the
    screen from everyone else and this refuses them.
    28 September (D27-122): and the accountant, who the export is for. */
const MAY_EXPORT = ["owner", "admin", "gm", "finance"];

/** The caller's role at this property, or "owner" for a group admin.

    ⚠ THE THIRD COPY of this query in the API (equipment/grants.ts and
    housekeeping/repairRoles.ts hold the other two). A service may not
    import another's insides, so a copy is the only way to ask it from
    here today; hoisting it into `auth.ts` is the master's, and is
    written down in MODULE.md under Requests. */
async function roleAt(client: Client, hotelId: string): Promise<string | null> {
  const { rows } = await client.query<{ role: string | null }>(
    `select case
              when exists (select 1 from staff s
                            where s.id = app.current_user_id()
                              and s.is_active and s.is_group_admin)
              then 'owner'
              else (select sh.role
                      from staff_hotels sh
                      join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id()
                       and sh.hotel_id = $1
                       and s.is_active
                     limit 1)
            end as role`,
    [hotelId],
  );
  return rows[0]?.role ?? null;
}

/** A financial year at a time. The export is a month or a year; a range
    of a decade is a mistyped year, and answering it means generating a
    row per day and scanning the ledger for all of them. */
const LONGEST_DAYS = 366;

/** Whole days between two 'YYYY-MM-DD' strings, counting both ends.
    Done in UTC on purpose: both are dates, not moments, and UTC is the
    one zone where adding a day cannot land on the same date twice. */
function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
    - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  return ms / 86_400_000 + 1;
}

export const accounting = new Hono<{ Variables: { subject: string } }>();

const NOT_YOURS = "The accounting export is the owner's, an administrator's, the general manager's and the accountant's.";

/* The ledger names in the hotel's Tally (D27-382): read and changed by whoever
   may export. A refusal returned in here commits nothing, because it is asked
   before anything is written. */
accounting.get("/:code/accounting/tally-ledgers", async (c) => {
  const answer = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return { status: 404 as const, body: { error: "No such property." } };
    const role = await roleAt(client, property.id);
    if (!role || !MAY_EXPORT.includes(role)) return { status: 403 as const, body: { error: NOT_YOURS } };
    return { status: 200 as const, body: await ledgerNames(client, property.id) };
  });
  return c.json(answer.body, answer.status);
});

accounting.put("/:code/accounting/tally-ledgers", async (c) => {
  const input = await c.req.json().catch(() => null) as { names?: Record<string, string> } | null;
  const answer = await withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code"));
    if (!property) return { status: 404 as const, body: { error: "No such property." } };
    const role = await roleAt(client, property.id);
    if (!role || !MAY_EXPORT.includes(role)) return { status: 403 as const, body: { error: NOT_YOURS } };
    const problem = namesProblem(input, (await ledgerNames(client, property.id)).ledgers);
    if (problem) return { status: 400 as const, body: { error: problem } };
    await saveLedgerNames(client, property.id, input!.names!);
    return { status: 200 as const, body: await ledgerNames(client, property.id) };
  });
  return c.json(answer.body, answer.status);
});

type Make<T> = (client: Client, property: Property, from: string, to: string) => Promise<T>;

/** One range, one property, one caller's right, then `make`: every file of
    this service is refused the same way. */
async function exported<T>(c: Context<{ Variables: { subject: string } }>, make: Make<T>) {
  const q = c.req.query();
  const from = isoDateParam(q["from"]);
  const to = isoDateParam(q["to"]);
  if (!from) return { status: 400 as const, body: { error: "The first date must be written YYYY-MM-DD." } };
  if (!to) return { status: 400 as const, body: { error: "The last date must be written YYYY-MM-DD." } };
  if (to < from) return { status: 400 as const, body: { error: "The last date is before the first one." } };
  if (daysBetween(from, to) > LONGEST_DAYS) {
    return { status: 400 as const, body: { error: "A range covers a year at most. Export one financial year at a time." } };
  }

  return withSession(c.get("subject"), async (client) => {
    const property = await propertyFor(client, c.req.param("code")!);
    if (!property) return { status: 404 as const, body: { error: "No such property." } };

    const role = await roleAt(client, property.id);
    if (!role || !MAY_EXPORT.includes(role)) return { status: 403 as const, body: { error: NOT_YOURS } };

    return { status: 200 as const, body: await make(client, property, from, to), property, from, to };
  }).catch((error: unknown) => {
    /* D27-173: no null and no guessed tax in a Tally export. ACC-4: a file
       that cannot be made says why, in a sentence. */
    if (error instanceof NoRoomRate || error instanceof TallyRefused) {
      return { status: 409 as const, body: { error: error.message } };
    }
    throw error;
  });
}

/* Named as the CSV is (src/lib/csv.ts, `reportFilename`), so the files sit
   side by side in a downloads folder. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* `day-book` answers the object; `day-book.xlsx` the same object as a real
   .xlsx (D22-37). */
accounting.get("/:code/accounting/:file{day-book(?:\\.xlsx)?}", async (c) => {
  const answer = await exported(c, dayBook);
  if (answer.status !== 200 || !c.req.param("file").endsWith(".xlsx")) {
    return c.json(answer.body, answer.status);
  }
  const name = `${slug(answer.body.property.name)}-day-book-${answer.from}-to-${answer.to}.xlsx`;
  return c.body(new Uint8Array(await dayBookXlsx(answer.body)), 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
});

/* The two Tally files (ACC-4): vouchers only, every one balanced, or a refusal
   in a sentence (tally.ts). */
accounting.get("/:code/accounting/:file{tally-(?:prime|erp9)\\.xml}", async (c) => {
  const answer = await exported(c, tallyVouchers);
  if (answer.status !== 200) return c.json(answer.body, answer.status);
  const version: TallyVersion = c.req.param("file") === "tally-prime.xml" ? "prime" : "erp9";
  const name = `${slug(answer.property.name)}-tally-${version}-${answer.from}-to-${answer.to}.xml`;
  return c.body(tallyXml(answer.body, version), 200, {
    "Content-Type": "application/xml",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
});
