import { toCsv, downloadCsv } from "@/lib/csv";

/* ══════════════════════════════════════════════════════════════════
   ONE SPEC, TWO USES

   The template somebody downloads and the parser that reads it back
   are generated from the SAME list of columns. That is the whole point
   of this file.

   The alternative — a static example file checked into the repo, and a
   parser written separately — has one failure mode and it is
   guaranteed: somebody adds a column to one of them. The file then
   teaches a shape the parser rejects, and the person filling it in has
   no way to know which of the two is wrong. A template that cannot
   drift from its reader is worth the small indirection.

   WHY CSV AND NOT XLSX. `csv.ts` sets this out at length: a spreadsheet
   library is half a megabyte to produce a file every spreadsheet on
   earth already opens, and two ways out of one report disagree about
   rounding eventually. The same holds coming in. Excel writes CSV from
   File → Save As, and a file that IS an .xlsx is detected and said so
   plainly rather than failing as gibberish — which is the failure this
   would otherwise have.
   ══════════════════════════════════════════════════════════════════ */

export interface Column {
  /** The header written into the template and matched on the way back. */
  header: string;
  /** The field it becomes. */
  field: string;
  required: boolean;
  /** Shown in the notes row of the template, and in the dialog. */
  note: string;
}

export interface ImportSpec {
  /** What one row is, in the plural. */
  what: string;
  filename: string;
  columns: Column[];
  /** Worked rows. Real-looking, and clearly examples — see below. */
  examples: string[][];
}

/* ── The menu ─────────────────────────────────────────────────────── */

export const MENU_SPEC: ImportSpec = {
  what: "menu items",
  filename: "menu-template",
  columns: [
    { header: "Section", field: "category", required: true,
      note: "Starters, Main course, Spirits. Created if it does not exist." },
    { header: "Dish", field: "name", required: true,
      note: "The name a guest reads on the bill." },
    { header: "Price", field: "price", required: true,
      note: "Rupees. A blank is REJECTED — it is not zero." },
    { header: "Tax heading", field: "taxKind", required: false,
      note: "restaurant, bar, banquet or other. Sets it for the whole "
          + "section. Leave blank to keep what the section already has." },
    { header: "GST %", field: "taxRate", required: false,
      note: "Only for an exception, such as bottled water on a food bill. "
          + "Blank means follow the section's heading, which is right for "
          + "nearly every dish." },
    { header: "Veg", field: "veg", required: false,
      note: "yes or no. Blank leaves it unsaid." },
    { header: "Short code", field: "shortCode", required: false,
      note: "What a waiter types instead of the name. Optional." },
  ],
  /* Deliberately obvious as examples and deliberately plausible as a
     menu: somebody has to be able to see the SHAPE, and a row reading
     "string, string, number" teaches nothing about what belongs in the
     Tax heading column. The prices are round numbers for the same
     reason — nobody will mistake them for the property's own. */
  examples: [
    ["Starters", "Paneer Tikka", "300", "restaurant", "", "yes", "PT"],
    ["Starters", "Chicken 65", "350", "restaurant", "", "no", ""],
    ["Beverages", "Bottled water", "50", "restaurant", "18", "yes", ""],
    ["Spirits", "Old Monk 60ml", "250", "bar", "", "", ""],
  ],
};

/* ── Rooms and room types ─────────────────────────────────────────── */

export const ROOM_TYPE_SPEC: ImportSpec = {
  what: "room types",
  filename: "room-types-template",
  columns: [
    { header: "Code", field: "code", required: true,
      note: "Two to four letters. SUP, DLX, STE." },
    { header: "Name", field: "name", required: true,
      note: "Superior, Deluxe, Suite." },
    { header: "Sleeps", field: "baseOccupancy", required: true,
      note: "How many the tariff covers." },
    { header: "Maximum", field: "maxOccupancy", required: true,
      note: "The most that may be put in the room." },
    { header: "Tariff", field: "rate", required: false,
      note: "Per night. Blank means UNPRICED — the type shows a dash and "
          + "cannot be sold until it has one. That is deliberate." },
    { header: "Extra adult", field: "extraAdult", required: false,
      note: "Blank means an extra adult makes the whole tariff a dash, "
          + "rather than adding nothing." },
    { header: "Extra child", field: "extraChild", required: false,
      note: "As above." },
  ],
  examples: [
    ["SUP", "Superior", "2", "3", "4000", "800", "500"],
    ["DLX", "Deluxe", "2", "3", "3500", "800", "500"],
  ],
};

export const ROOM_SPEC: ImportSpec = {
  what: "rooms",
  filename: "rooms-template",
  columns: [
    { header: "Room number", field: "number", required: true,
      note: "As it appears on the door. 201, 14A." },
    { header: "Type code", field: "typeCode", required: true,
      note: "Must match a room type that already exists." },
    { header: "Floor", field: "floor", required: false,
      note: "A number. Blank leaves it unsaid." },
    { header: "Smoking", field: "smoking", required: false,
      note: "yes or no. Blank means no." },
  ],
  examples: [
    ["201", "SUP", "2", "no"],
    ["202", "SUP", "2", "no"],
    ["301", "DLX", "3", "no"],
  ],
};

/* ── The template ─────────────────────────────────────────────────── */

/**
 * Build and download the example file for a spec.
 *
 * Three parts: the headers the parser matches on, a NOTES row saying
 * what each column is for, and worked examples. The notes row starts
 * with `#` so the parser skips it — somebody who deletes the examples
 * and keeps the notes still gets a file that reads correctly, and
 * somebody who deletes everything and starts from the headers does
 * too.
 */
export function downloadTemplate(spec: ImportSpec): void {
  const headers = spec.columns.map((c) => c.header);
  const notes = spec.columns.map(
    (c, i) => (i === 0 ? "# " : "") + (c.required ? "REQUIRED. " : "") + c.note);

  downloadCsv(`${spec.filename}.csv`, toCsv(headers, [notes, ...spec.examples]));
}

/* ── Reading one back ─────────────────────────────────────────────── */

export interface ParseResult<T> {
  rows: T[];
  /** Headers in the file that the spec does not know about. */
  unknown: string[];
  /** Required columns the file is missing entirely. */
  missing: string[];
}

/**
 * Split a line of CSV, honouring quotes.
 *
 * Small on purpose. The one thing that genuinely matters is a quoted
 * field containing a comma — "Chicken Tikka, half" is a real dish name
 * and splitting on every comma turns it into two broken rows.
 */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // "" is one quote
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  /* csv.ts prefixes a tab to any value starting `=`, `+`, `-` or `@` so
     a spreadsheet does not execute it as a formula. Undo that here or a
     round trip through our own export comes back with tabs in it. */
  return out.map((v) => v.replace(/^\t/, "").trim());
}

export function parseCsv<T extends Record<string, string>>(
  text: string, spec: ImportSpec,
): ParseResult<T> {
  /* A file saved on Windows has \r\n, one from a Mac may have \r alone,
     and a file that has been through both has a mixture. */
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) return { rows: [], unknown: [], missing: [] };

  const headers = splitLine(lines[0]!);
  const byHeader = new Map(
    spec.columns.map((c) => [c.header.toLowerCase(), c.field]));

  const unknown = headers.filter(
    (h) => h && !byHeader.has(h.toLowerCase()));
  const present = new Set(
    headers.map((h) => byHeader.get(h.toLowerCase())).filter(Boolean));
  const missing = spec.columns
    .filter((c) => c.required && !present.has(c.field))
    .map((c) => c.header);

  const rows: T[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);

    /* The notes row from the template, and anything else somebody has
       commented out.

       ⚠ THIS CHECKED THE RAW LINE, and the notes row is QUOTED by our
       own writer — it contains commas — so the line starts with `"` and
       never matched. The template's own instructions imported as a dish
       called "# REQUIRED. Starters, Main course, Spirits...". Caught by
       the round-trip test, which is the entire reason it exists. */
    if ((cells[0] ?? "").startsWith("#")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      const field = byHeader.get(h.toLowerCase());
      if (field) row[field] = cells[i] ?? "";
    });
    if (Object.values(row).some((v) => v !== "")) rows.push(row as T);
  }

  return { rows, unknown, missing };
}

/**
 * What went wrong before a single row was read.
 *
 * A wrong file is far commoner than a wrong row, and the failure is
 * silent otherwise: an .xlsx read as text is binary noise, and every
 * row fails for a reason that has nothing to do with the reason.
 */
export function fileProblem(file: File): string | null {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return "That is an Excel workbook. Open it, choose File → Save As, "
         + "and pick CSV — then send that file. The template downloads in "
         + "the same format and opens in Excel.";
  }
  if (name.endsWith(".numbers") || name.endsWith(".ods")) {
    return "Export that as CSV first — the template downloads in that "
         + "format and your spreadsheet will open it.";
  }
  if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
    return `"${file.name}" is not a CSV file.`;
  }
  if (file.size > 2_000_000) {
    return "That file is larger than two megabytes, which is far bigger "
         + "than any menu. It is almost certainly not the right file.";
  }
  return null;
}
