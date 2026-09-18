import { it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   ONE NUMBER, ONE MIGRATION

   The database history is one sequence, replayed from 001 on every
   deploy (db/migrate.sh), and later files build on earlier ones across
   services — so it stays one folder even though the code is split by
   service. With several agents working at once, two of them reaching for
   "the next number" would both write 090. The number is claimed in
   HANDOVER first; this is what refuses the collision if it happens anyway.
   ══════════════════════════════════════════════════════════════════ */

const DIR = join(__dirname, "..", "..", "db", "migrations");

it("migrations are numbered 001 upwards, once each, with no gaps", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const badNames = files.filter((f) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f));
  expect(badNames).toEqual([]);

  const numbers = files.map((f) => Number(f.slice(0, 3)));
  const taken = new Map<number, string[]>();
  files.forEach((f, i) => taken.set(numbers[i]!, [...(taken.get(numbers[i]!) ?? []), f]));
  const twice = [...taken.values()].filter((names) => names.length > 1);
  expect(twice).toEqual([]);

  const expected = Array.from({ length: files.length }, (_, i) => i + 1);
  expect(numbers).toEqual(expected);
});
