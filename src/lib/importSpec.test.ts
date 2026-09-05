import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";
import {
  MENU_SPEC, ROOM_TYPE_SPEC, ROOM_SPEC, parseCsv, fileProblem,
  type ImportSpec,
} from "@/lib/importSpec";

/* ══════════════════════════════════════════════════════════════════
   THE TEMPLATE AND THE PARSER ARE ONE THING

   Both are generated from the same column list, and the reason that
   matters is worth stating: the alternative is an example file checked
   into the repo and a reader written separately, which has exactly one
   failure mode and it is certain. Somebody adds a column to one of
   them, the file then teaches a shape the reader rejects, and the
   person filling it in has no way to tell which of the two is wrong.

   This asserts the round trip rather than the claim.
   ══════════════════════════════════════════════════════════════════ */

/** What `downloadTemplate` writes, without touching the DOM. */
function templateText(spec: ImportSpec): string {
  const headers = spec.columns.map((c) => c.header);
  const notes = spec.columns.map(
    (c, i) => (i === 0 ? "# " : "") + (c.required ? "REQUIRED. " : "") + c.note);
  return toCsv(headers, [notes, ...spec.examples]);
}

const SPECS: [string, ImportSpec][] = [
  ["menu", MENU_SPEC],
  ["room types", ROOM_TYPE_SPEC],
  ["rooms", ROOM_SPEC],
];

describe.each(SPECS)("the %s template", (_name, spec) => {
  it("parses back into exactly the rows it was built from", () => {
    const parsed = parseCsv(templateText(spec), spec);

    expect(parsed.missing, "the template is missing its own required columns")
      .toEqual([]);
    expect(parsed.unknown, "the template carries a column its reader ignores")
      .toEqual([]);
    expect(parsed.rows.length).toBe(spec.examples.length);
  });

  it("skips the notes row rather than importing it as a record", () => {
    const parsed = parseCsv(templateText(spec), spec);
    const first = spec.columns[0]!.field;
    /* The notes row starts with `#`. If it came through, the first row
       would be a paragraph of prose pretending to be a dish. */
    expect(parsed.rows.every((r) => !String(r[first] ?? "").startsWith("#")))
      .toBe(true);
  });

  it("carries every value into the field the reader expects", () => {
    const parsed = parseCsv(templateText(spec), spec);
    spec.examples.forEach((example, i) => {
      spec.columns.forEach((col, j) => {
        expect(parsed.rows[i]![col.field]).toBe(example[j]);
      });
    });
  });

  it("names its required columns as required in the notes", () => {
    /* Somebody deletes the examples and keeps the notes. The file has to
       still say which columns cannot be left out. */
    const text = templateText(spec);
    const notesLine = text.split("\n")[1] ?? "";
    const required = spec.columns.filter((c) => c.required);
    expect(required.length).toBeGreaterThan(0);
    expect((notesLine.match(/REQUIRED/g) ?? []).length).toBe(required.length);
  });
});

describe("reading a file back", () => {
  it("keeps a comma inside quotes in one field", () => {
    /* "Chicken Tikka, half" is a real dish name, and splitting on every
       comma turns one row into two broken ones. */
    const text = "Section,Dish,Price\nStarters,\"Chicken Tikka, half\",250\n";
    const { rows } = parseCsv(text, MENU_SPEC);
    expect(rows.length).toBe(1);
    expect(rows[0]!["name"]).toBe("Chicken Tikka, half");
    expect(rows[0]!["price"]).toBe("250");
  });

  it("survives Windows line endings", () => {
    const { rows } = parseCsv(
      "Section,Dish,Price\r\nStarters,Papad,40\r\n", MENU_SPEC);
    expect(rows.length).toBe(1);
    expect(rows[0]!["name"]).toBe("Papad");
  });

  it("strips the formula guard our own export adds", () => {
    /* csv.ts prefixes a tab to any value starting `=`, `+`, `-` or `@`
       so a spreadsheet does not execute it. A round trip through our own
       export must not come back with tabs in the data. */
    const text = toCsv(["Section", "Dish", "Price"],
                       [["Starters", "=Special", "100"]]);
    const { rows } = parseCsv(text, MENU_SPEC);
    expect(rows[0]!["name"]).toBe("=Special");
  });

  it("reports a missing required column instead of importing blanks", () => {
    const { missing } = parseCsv("Section,Dish\nStarters,Papad\n", MENU_SPEC);
    expect(missing).toContain("Price");
  });

  it("reports an unknown column without refusing the file", () => {
    /* Somebody's own sheet carries a supplier column and a note to
       themselves. Refusing over that would be officious; saying nothing
       would let a misspelled header pass as a working one. */
    const { rows, unknown } = parseCsv(
      "Section,Dish,Price,Supplier\nStarters,Papad,40,Kirana\n", MENU_SPEC);
    expect(unknown).toEqual(["Supplier"]);
    expect(rows.length).toBe(1);
  });

  it("ignores an entirely blank line", () => {
    const { rows } = parseCsv(
      "Section,Dish,Price\nStarters,Papad,40\n\n,,\n", MENU_SPEC);
    expect(rows.length).toBe(1);
  });
});

describe("the wrong file, said plainly", () => {
  const file = (name: string, size = 100) =>
    ({ name, size }) as File;

  it("tells somebody what to do with an Excel workbook", () => {
    /* The failure this replaces: an .xlsx read as text is binary noise,
       and every row then fails for a reason unrelated to the real one. */
    const msg = fileProblem(file("menu.xlsx"));
    expect(msg).toMatch(/Save As/i);
    expect(msg).toMatch(/CSV/);
  });

  it("accepts a csv", () => {
    expect(fileProblem(file("menu.csv"))).toBeNull();
  });

  it("refuses something far too large to be a menu", () => {
    expect(fileProblem(file("menu.csv", 5_000_000))).toMatch(/megabytes/);
  });
});
