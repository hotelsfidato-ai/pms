/* ══════════════════════════════════════════════════════════════════
   DEMO MODE — the application, with the API baked in

   A frontend sent to a client for review has no server behind it. This
   answers the requests the seam makes from a snapshot captured off the
   real API against the loaded demo, so the figures are the calibrated
   ones — 431 available room-nights, 132 sold, 30.63% — and not numbers
   written to look plausible.

   ONE INTERCEPTION POINT

   `api()` in api.ts is the only place a request is made, so this is the
   only place that has to change. No screen and no repository knows the
   difference, which is the same seam argument that let twelve modules
   move onto Postgres without a screen noticing.

   WRITES

   There is nowhere to write to. Rather than let a button do nothing —
   the defect this project keeps finding — every write is refused with a
   sentence that says why, and the interface shows it in the toast it
   already shows refusals in. A reviewer clicking "Check in" learns
   immediately that this build is read-only, which is true, instead of
   watching a spinner and guessing.
   ══════════════════════════════════════════════════════════════════ */

import snapshot from "@/data/demo-snapshot.json";

export const DEMO = import.meta.env.VITE_DEMO_MODE === "1";

const table = snapshot as Record<string, unknown>;

/** Built once: path without its query, for the fallback below. */
const byPath = new Map<string, unknown>();
for (const [key, value] of Object.entries(table)) {
  const bare = key.split("?")[0]!;
  if (!byPath.has(bare)) byPath.set(bare, value);
}

/**
 * A recorded answer for this request, or undefined.
 *
 * Exact match first. Then path-only — a report whose date range the
 * viewer changes still renders the snapshot rather than erroring. That
 * is a real limitation and the reason the build carries a banner saying
 * the data is fixed; silently showing different numbers for a range
 * nobody captured would be worse than showing the same ones.
 */
export function recorded(path: string): unknown | undefined {
  if (path in table) return table[path];
  return byPath.get(path.split("?")[0]!);
}

/** Written to make the refusal readable wherever the seam surfaces it. */
export const DEMO_REFUSAL =
  "This is a preview build with no server behind it, so nothing can be "
  + "saved. Every screen and every figure is real; only writing is off.";
