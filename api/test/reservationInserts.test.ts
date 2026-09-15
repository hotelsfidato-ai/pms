import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* ══════════════════════════════════════════════════════════════════
   EVERY DOOR A BOOKING COMES THROUGH RECORDS ITS CHANNEL

   082 made the channel compulsory and said the API enforced it. The
   API had two statements that create a reservation, and the rule went
   into one: the booking form refused a booking with no channel, and the
   walk-in desk went on saving them. Defect 242 — found on production,
   where the stay list still read "Walk-in" through the label fallback,
   so nothing looked wrong.

   A rule of the form "every X must have Y" is only as good as the list
   of places that make an X. This file keeps that list honest: it finds
   every `insert into reservations` under api/src and fails if one of
   them does not write `booking_source_id`. A third door added next
   month fails here, not on production.

   ⚠ api/scripts IS NOT SCANNED, deliberately. The demo loaders there
   write sample history for a development database; they are not a way
   a guest's booking reaches the hotel.
   ══════════════════════════════════════════════════════════════════ */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

type Insert = { file: string; line: number; columns: string };

/* The column list is everything between `insert into reservations` and
   the closing parenthesis of its first group — the statement's own
   words, not a guess at them. */
const inserts = (): Insert[] =>
  walk(SRC)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/insert\s+into\s+reservations\s*\(([^)]*)\)/gi)]
        .map((m) => ({
          file: file.slice(SRC.length + 1),
          line: text.slice(0, m.index).split("\n").length,
          columns: m[1]!,
        }));
    });

describe("every way a reservation is created", () => {
  it("finds the doors at all", () => {
    /* Without this the next test passes vacuously on an empty list —
       which is how a guard ends up agreeing with everything. Two today:
       the booking form and the walk-in desk. */
    expect(inserts().length).toBeGreaterThanOrEqual(2);
  });

  it("⚠ RECORDS THE BOOKING CHANNEL ON EVERY ONE", () => {
    const missing = inserts()
      .filter((i) => !/\bbooking_source_id\b/.test(i.columns))
      .map((i) => `${i.file}:${i.line}`);

    expect(
      missing,
      "these create a reservation with no booking channel — the booking "
      + "form refuses that, so every other door must too:\n  "
      + missing.join("\n  "),
    ).toEqual([]);
  });
});
