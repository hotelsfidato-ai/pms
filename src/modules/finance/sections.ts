/* ══════════════════════════════════════════════════════════════════
   THE BILL IN SECTIONS (the owner's D27-200, 30 September)

   Room with GST, Restaurant with GST, Bar with VAT, then the other charges -
   on the Bill tab and on the printed bill alike. ONE place decides where a
   line sits and adds a section up, so the screen and the print cannot differ.

   A line is placed by WHAT IT WAS BILLED UNDER - its category and its tax
   scheme - never by the words in its description. A posting does not carry
   the tax rule it was billed under (room, laundry, spa…), only gst or vat, so
   the desk's early arrival, late departure and extra person fees (category
   misc) sit with the other charges until it does.

   NO FIGURE IS MADE HERE THAT THE BILL DID NOT HAVE: a subtotal is its lines'
   amounts added, a tax row its lines' tax added, in paise. The sections'
   subtotals and taxes add up to the bill's own total (billSections.test.ts).
   ══════════════════════════════════════════════════════════════════ */

export type SectionKey = "room" | "restaurant" | "bar" | "other";

/** What a line must say to be placed and added up. */
export interface SectionLine {
  category: string;
  /** "vat" is alcohol (D21-91); absent on a bill from an older server: GST. */
  scheme?: string | null;
  amount: number;
  tax: number;
  rate?: number | null;
}

export interface BillSection<T> {
  key: SectionKey;
  title: string;
  lines: T[];
  subtotal: number;
  /** One row per tax and rate in the section: "GST 5%", "VAT 10%". */
  taxes: { label: string; amount: number }[];
}

export function sectionOf(line: Pick<SectionLine, "category" | "scheme">): SectionKey {
  if (line.scheme === "vat") return "bar";
  if (line.category === "room") return "room";
  if (line.category === "food" || line.category === "beverage") return "restaurant";
  return "other";
}

const ORDER: SectionKey[] = ["room", "restaurant", "bar", "other"];
const paise = (n: number) => Math.round(n * 100);

/** The charges (never the payments), grouped in the owner's order. A section
    with no line is left out, except those named in `keep`. */
export function billSections<T extends SectionLine>(lines: T[], keep: SectionKey[] = []): BillSection<T>[] {
  return ORDER.flatMap((key) => {
    const own = lines.filter((l) => sectionOf(l) === key);
    if (own.length === 0 && !keep.includes(key)) return [];
    const taxes = new Map<string, number>();
    for (const l of own) {
      if (l.tax === 0) continue;
      const label = `${l.scheme === "vat" ? "VAT" : "GST"}${l.rate == null ? "" : ` ${Number(l.rate)}%`}`;
      taxes.set(label, (taxes.get(label) ?? 0) + paise(l.tax));
    }
    return [{
      key,
      title: key === "room" ? "Room" : key === "restaurant" ? "Restaurant" : key === "bar" ? "Bar"
        : own.some((l) => l.category === "discount" || l.category === "tax")
          ? "Other charges and adjustments" : "Other charges",
      lines: own,
      subtotal: own.reduce((n, l) => n + paise(l.amount), 0) / 100,
      taxes: [...taxes].filter(([, p]) => p !== 0).map(([label, p]) => ({ label, amount: p / 100 })),
    }];
  });
}

/** What the sections come to: their subtotals and taxes added. */
export const sectionsTotal = (sections: BillSection<SectionLine>[]): number =>
  sections.reduce((n, s) => n + paise(s.subtotal) + s.taxes.reduce((t, x) => t + paise(x.amount), 0), 0) / 100;
