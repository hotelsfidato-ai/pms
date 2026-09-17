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

/* The published preview runs inside a viewer that will not let a page
   download anything on its own - `<a download>` is inert there, blob
   href included. A report's CSV button would appear to work and do
   nothing, which is the defect this project keeps finding.

   `claude.use("downloads")` is the mediated path: the viewer sees a
   confirmation and may decline. It exists only inside that viewer, so
   this is a FEATURE TEST rather than a build flag - the same file
   served from an ordinary web server takes the link path below. */
async function offerThroughViewer(
  filename: string, body: string,
): Promise<boolean> {
  const host = (globalThis as {
    claude?: { use?: (name: string) => Promise<unknown> };
  }).claude;
  if (typeof host?.use !== "function") return false;

  try {
    const downloads = (await host.use("downloads")) as
      | { save: (r: { filename: string; data: string }) => Promise<unknown> }
      | null;
    if (!downloads) return false;
    await downloads.save({ filename, data: body });
  } catch {
    /* Declined, rate-limited, or unavailable. Handled either way: the
       viewer has already been shown the outcome, and falling through
       to a link that cannot work would only look like a second
       failure. */
  }
  return true;
}

/**
 * Hand the file to the browser.
 *
 * A BOM leads the file. Without it Excel reads UTF-8 as the system
 * codepage and every ₹ becomes â‚¹ - on a report whose whole subject is
 * rupees.
 */
export function downloadCsv(filename: string, csv: string): void {
  /* The BOM is written as an escape, not as the invisible character it
     is. A literal BOM in source survives until an editor, a linter
     or a git filter decides to tidy it, and its absence shows up
     as mojibake in somebody else's spreadsheet weeks later. */
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const body = `\uFEFF${csv}`;

  void offerThroughViewer(name, body).then((handled) => {
    if (!handled) saveByLink(name, body);
  });
}

/** The ordinary browser path: a blob, and a link, clicked. */
function saveByLink(name: string, body: string): void {
  const blob = new Blob([body], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
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
