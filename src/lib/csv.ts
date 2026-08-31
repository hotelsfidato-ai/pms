/* ══════════════════════════════════════════════════════════════════
   EXPORTING A REPORT

   Every report in this system printed and nothing else. The Lodging Tax
   report was specified as a statutory EXCEL export and had a Print
   button, which is the one thing an accountant cannot paste into a
   return.

   CSV, not xlsx. A spreadsheet library is half a megabyte to produce a
   file every accounting package on earth already opens, and the moment
   there are two ways out of a report they disagree about rounding.

   THE THINGS THAT GO WRONG WITH CSV, AND WHAT IS DONE ABOUT THEM
   ══════════════════════════════════════════════════════════════════ */

/**
 * One cell.
 *
 * Quoted when it has to be, and the leading-character guard is not
 * paranoia: a value beginning `=`, `+`, `-` or `@` is executed as a
 * formula when the file is opened, which is how a spreadsheet becomes
 * an attack. Prefixing a tab neutralises it and is invisible in every
 * reader.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  /* Formula injection. A guest called "=cmd" is not hypothetical — the
     name field takes whatever a passport says. */
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Build a CSV from a header row and body rows.
 *
 * CRLF line endings, because Excel on Windows is what opens these and
 * bare LF makes it treat the file as one line in some locales.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return lines.join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * A BOM leads the file. Without it Excel reads UTF-8 as the system
 * codepage and every ₹ becomes â‚¹ — on a report whose whole subject is
 * rupees.
 */
export function downloadCsv(filename: string, csv: string): void {
  /* The BOM is written as an escape, not as the invisible character it
     is. A literal BOM in source survives until an editor, a linter
     or a git filter decides to tidy it, and its absence shows up
     as mojibake in somebody else's spreadsheet weeks later. */
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  /* Revoked on the next tick rather than immediately: some browsers
     have not started reading the blob when click() returns. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A filename somebody can find again in a downloads folder six months
 * later: the property, the report and the date it covers.
 */
export function reportFilename(
  property: string, report: string, period: string,
): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(property)}-${slug(report)}-${slug(period)}.csv`;
}
