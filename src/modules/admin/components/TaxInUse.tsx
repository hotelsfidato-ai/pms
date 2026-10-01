import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { money, moneyPrecise, number } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { getTaxInUse, type TaxInUse, type TaxKind } from "@/modules/admin/data/taxInUse";

/* ══════════════════════════════════════════════════════════════════
   THE GST A PROPERTY CHARGES, ONE LINE PER KIND — ADM-2, D17-37

   Drawn on Settings and on every Properties card, from the one reader
   (`getTaxInUse`, finance's `GET /:code/tax`). The caller draws the row,
   because a Settings row and a card line are different markup; the words
   are decided here, once.

   ⚠ THE KIND NAMES ARE A COPY of `LABEL` in
   `src/modules/finance/flows/TaxRulesCard.tsx`, where the rules are set,
   so a person reads the same five words in both places. Finance's front
   door does not export them; if finance renames one, rename it here.
   ══════════════════════════════════════════════════════════════════ */

export const TAX_KINDS: readonly TaxKind[] = ["room", "restaurant", "bar", "banquet", "spa", "alcohol", "laundry", "other"];

export const TAX_KIND_LABEL: Record<TaxKind, string> = {
  room: "Rooms",
  restaurant: "Restaurant",
  bar: "Bar",
  banquet: "Banquet",
  spa: "Spa",
  alcohol: "Alcohol",
  laundry: "Laundry",
  other: "Everything else",
};

/* Alcohol is VAT, not GST (D21-91), and finance lists it only where the
   property serves it (D21-90) - so it has a row only when it is there. */
const OPTIONAL: readonly TaxKind[] = ["alcohol"];
const TAX_NAME = (kind: TaxKind) => (kind === "alcohol" ? "VAT" : "GST");

/* A boundary is printed exactly. `money` rounds to the rupee, and a slab
   above ₹7,500.50 printed as "above ₹7,501" would misstate where the rate
   changes. */
const amount = (value: number) =>
  Number.isInteger(value) ? money(value) : moneyPrecise(value);

/**
 * The rates in use for one kind, in words.
 *
 *   no slabs                  "-"   nobody has set a rate (D17-49)
 *   one slab from 0           "5%"
 *   slabs                     "5% up to ₹7,500 · 18% above ₹7,500"
 *
 * "Up to" includes the boundary: `over_amount` is the value a rate applies
 * ABOVE (067), so a ₹7,500 room is 5% and ₹7,500.01 is 18%.
 */
export function taxLine(slabs: TaxInUse["slabs"]): string {
  if (slabs.length === 0) return "-";
  if (slabs.length === 1 && slabs[0]!.overAmount === 0) return `${number(slabs[0]!.rate)}%`;

  return slabs.map((s, i) => {
    const rate = `${number(s.rate)}%`;
    const next = slabs[i + 1];
    const from = s.overAmount === 0 ? "" : ` above ${amount(s.overAmount)}`;
    const to = next ? ` up to ${amount(next.overAmount)}` : "";
    return `${rate}${from}${to}`;
  }).join(" · ");
}

/**
 * One row per kind of supply, in a fixed order, through `row`.
 *
 * Loading draws placeholders; a failed read says so in one row — never a
 * dash, which would claim that nothing is set.
 */
export function TaxInUseRows({ hotelCode, row }: {
  hotelCode: string;
  row: (label: string, value: string, key: string) => ReactNode;
}) {
  const tax = useQuery({
    queryKey: ["tax-in-use", hotelCode],
    queryFn: () => getTaxInUse(hotelCode),
    enabled: Boolean(hotelCode),
  });

  if (!hotelCode) return null;
  if (tax.isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (tax.error || !tax.data) {
    return <>{row("GST", "Could not load. Reload to try again.", "gst-error")}</>;
  }

  return (
    <>
      {TAX_KINDS.map((kind) => {
        const rules = tax.data.find((k) => k.kind === kind);
        if (!rules && OPTIONAL.includes(kind)) return null;
        return row(
          `${TAX_NAME(kind)} on ${TAX_KIND_LABEL[kind].toLowerCase()}`,
          taxLine(rules?.slabs ?? []),
          `gst-${kind}`,
        );
      })}
    </>
  );
}
