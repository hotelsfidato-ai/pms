import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";
import { MENU_SPEC, parseCsv } from "@/lib/importSpec";
import { ADDON_SPEC } from "@/modules/pos/lib/addonSpec";

/* The add-ons template reads back as the rows it was built from, and
   every group the menu template names is one it makes - the two files
   are imported one after the other (D21-43). */

const template = (spec: typeof ADDON_SPEC) => toCsv(
  spec.columns.map((c) => c.header),
  [spec.columns.map((c, i) => (i === 0 ? "# " : "") + (c.required ? "REQUIRED. " : "") + c.note),
   ...spec.examples]);

describe("the add-ons template", () => {
  it("parses back into exactly its examples, notes row skipped", () => {
    const { rows, missing, unknown } = parseCsv(template(ADDON_SPEC), ADDON_SPEC);
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
    expect(rows.map((r) => ADDON_SPEC.columns.map((c) => r[c.field])))
      .toEqual(ADDON_SPEC.examples);
  });

  it("prices every preference with a typed 0, never a blank", () => {
    expect(ADDON_SPEC.examples.every((e) => e[2] !== "")).toBe(true);
  });

  it("makes every group the menu template names", () => {
    const made = new Set(ADDON_SPEC.examples.map((e) => e[0]));
    const named = MENU_SPEC.examples.flatMap((e) =>
      (e[MENU_SPEC.columns.findIndex((c) => c.field === "addonGroups")] ?? "")
        .split(";").map((g) => g.trim()).filter(Boolean));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((g) => !made.has(g))).toEqual([]);
  });
});
