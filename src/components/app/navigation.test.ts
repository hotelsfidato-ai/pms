import { describe, expect, it } from "vitest";
import { navigationFor, type NavItem } from "./navigation";

/* ══════════════════════════════════════════════════════════════════
   THE MENU'S NAMING RULES, ENFORCED

   The clarity plan of 15 September found the menu speaking two ways at
   once: "City ledger" under Finance and "City Ledger" under Reports —
   two different screens — and "Night Audit" in the menu over a page
   headed "Night audit". Wording drifts one label at a time, and nobody
   reviewing a single change sees the whole menu. These tests do.
   ══════════════════════════════════════════════════════════════════ */

/** Every label the owner's menu can show — sections, items, children. */
function everyLabel(): string[] {
  const labels: string[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      labels.push(item.label);
      walk(item.children ?? []);
    }
  };
  for (const section of navigationFor("owner", "5EL")) {
    if (section.label) labels.push(section.label);
    walk(section.items);
  }
  return labels;
}

/* Words that keep their capitals wherever they fall: acronyms, and the
   names of statutory forms. Anything else capitalised after the first
   word is Title Case creeping back. */
const PROPER = new Set(["GST", "Form", "F", "C", "C-Form", "Fidato", "POS"]);

describe("the menu speaks one way", () => {
  it("writes every label in sentence case", () => {
    const offenders = everyLabel().filter((label) =>
      label
        .split(/[\s/]+/)
        .slice(1)
        .some((word) => /^[A-Z]/.test(word) && !PROPER.has(word)),
    );
    expect(offenders).toEqual([]);
  });

  it("never gives two places the same name", () => {
    /* Two screens both called "City ledger" is how a clerk ends up on
       the report when they wanted the accounts. A parent that opens the
       same page as its first child is allowed to share its name only
       if they are genuinely the same destination — none do today. */
    const seen = new Map<string, number>();
    for (const label of everyLabel()) {
      seen.set(label.toLowerCase(), (seen.get(label.toLowerCase()) ?? 0) + 1);
    }
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([label]) => label);
    expect(duplicates).toEqual([]);
  });
});
