import { downloadFile } from "@/lib/api";
import type { ExportKind, ListScreenKey } from "../../../../api/src/modules/reports/listExports.ts";

export { LIST_SCREENS, exportRefusal } from "../../../../api/src/modules/reports/listExports.ts";
export type { ExportKind, ListScreenKey };

/* ══════════════════════════════════════════════════════════════════
   A LIST SCREEN AS A FILE - the web's half (D27-383 item 1)

   The screen hands over the rows it shows - after its filters, search and
   sort, every one of them - with the columns as they read on screen and its
   filters as words. The server draws the PDF or the Excel under the hotel's
   name, the screen's name, who and when (api/src/modules/reports/listFiles.ts).
   Values are raw: money in rupees as a number, a date "YYYY-MM-DD". A value
   nobody has is null and prints "-", never 0.
   ══════════════════════════════════════════════════════════════════ */

export interface ExportColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
  /** Text when absent. "id" is a guest's ID number: the file masks it. */
  kind?: ExportKind;
}

/** The screen's filters, search, sort and period, as it shows them. An
    empty one is left out. */
export type ExportFacts = Array<[label: string, value: string | number | null | undefined | false]>;

const cell = (v: string | number | null | undefined) =>
  v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? null : v;

/** What the server is sent: plain data, so a test can read it. */
export function exportBody<T>(columns: ExportColumn<T>[], rows: T[], facts: ExportFacts = []) {
  return {
    columns: columns.map((c) => ({ label: c.label, kind: c.kind ?? "text" })),
    rows: rows.map((r) => columns.map((c) => cell(c.value(r)))),
    facts: facts
      .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
      .map(([label, v]) => ({ label, value: String(v) })),
  };
}

/** Saves the file; resolves to its name, or throws the server's sentence. */
export const exportList = <T>(
  hotel: string, screen: ListScreenKey, format: "pdf" | "xlsx",
  columns: ExportColumn<T>[], rows: T[], facts?: ExportFacts,
) => downloadFile(`/api/hotels/${hotel}/exports/${screen}.${format}`, exportBody(columns, rows, facts));
