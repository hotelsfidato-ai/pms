import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   DOCUMENTS — every bill, invoice and voucher the system prints

   The owner, 27 September: the CRS's reservation voucher is the reference
   for all the branding on paper ("this is the main reference design; all
   my branding needs to come from this"). Its parts are here once, so the
   tax invoice, the VAT bill, the guest's bill and later the restaurant
   bill and the reports all print the same way:

     masthead     the logo (or the property's name) on the left; the
                  document's name and number behind an orange bar on the
                  right; an orange rule and a hairline under both
     facts        a washed strip of small labelled facts
     parties      two columns, a hairline between
     table        labels over a 2px ink rule, rows on hairlines
     totals       label left, figure right, a 2px ink rule over the total
     panel        the one block somebody must not miss, orange-edged
     footer       a 2px ink rule, who issued it and how to reach them

   Sans, as the voucher (DESIGN.md's Georgia for print is retired by this).
   Sizes stay on the type ladder: 12 for labels, 14 for the body, 16 for
   names and the total, 20 for a name standing in for a logo. Colours
   print: `print-color-adjust: exact` is set on the page.

   Presentation only. Every figure and word is the caller's.
   ══════════════════════════════════════════════════════════════════ */

/** The grey page with the A4 sheet on it; `toolbar` stays off the paper. */
export function DocPage({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-grey-100 print:bg-white min-h-full py-6 print:py-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {toolbar && (
        <div className="no-print max-w-[210mm] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 px-4">
          {toolbar}
        </div>
      )}
      <article className="max-w-[210mm] mx-auto bg-white text-ink-700 px-5 py-6 sm:px-[14mm] sm:py-[16mm] print:p-0">
        {children}
      </article>
    </div>
  );
}

/** Small capitals over a value, the voucher's label. */
export function DocLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs font-bold uppercase tracking-[0.08em] text-grey-500", className)}>
      {children}
    </p>
  );
}

export function DocMasthead({ logo, name, title, number, children }: {
  /** An image source for the group's logo; null prints `name` instead. */
  logo?: string | null;
  name: string;
  /** The document's name, e.g. "Tax invoice". Printed in capitals. */
  title: string;
  number: string;
  /** Anything under the number: the date of issue, the business date. */
  children?: ReactNode;
}) {
  return (
    <header>
      <div className="flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-start max-sm:gap-3 print:flex-row print:items-center">
        <div className="min-w-0">
          {logo ? (
            <img src={logo} alt={name} className="h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <p className="text-xl font-extrabold tracking-[-0.01em] text-ink-700">{name}</p>
          )}
        </div>
        <div className="shrink-0 border-l-4 border-accent-from pl-2.5">
          <p className="text-md font-extrabold uppercase tracking-[0.06em] text-ink-700">{title}</p>
          <p className="text-xs text-grey-500 tabular mt-0.5">{number}</p>
          {children && <div className="text-xs text-grey-500 mt-0.5">{children}</div>}
        </div>
      </div>
      <div className="h-[3px] bg-accent-from mt-3" />
      <div className="h-px bg-grey-200 mb-4" />
    </header>
  );
}

/** The washed strip of facts: the voucher's booked on / status / total. */
export function DocFacts({ items, className }: {
  items: Array<{ label: string; value: ReactNode; note?: ReactNode; end?: boolean; strong?: boolean }>;
  className?: string;
}) {
  return (
    <div
      /* On a phone, two across and a hairline under each row instead of
         between the cells (the Breathing Room Rule). */
      className={cn(
        "grid grid-cols-[repeat(var(--n),minmax(0,1fr))] rounded-md border border-grey-200 bg-grey-50 divide-x divide-grey-200",
        "max-sm:grid-cols-2 max-sm:divide-x-0 print:grid-cols-[repeat(var(--n),minmax(0,1fr))] print:divide-x",
        className,
      )}
      style={{ "--n": items.length } as CSSProperties}
    >
      {items.map((f) => (
        <div key={f.label} className={cn("px-3.5 py-2.5 min-w-0", f.end && "text-right")}>
          <DocLabel>{f.label}</DocLabel>
          <p className={cn("mt-0.5 tabular", f.strong ? "text-md font-extrabold" : "text-sm font-semibold")}>{f.value}</p>
          {f.note && <p className="text-xs text-grey-500">{f.note}</p>}
        </div>
      ))}
    </div>
  );
}

/** Two columns with a hairline between: the hotel, the guest. */
export function DocParties({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-2 mt-5 [&>*:first-child]:pr-3.5 [&>*+*]:pl-3.5 [&>*+*]:border-l [&>*+*]:border-grey-200", className)}>
      {children}
    </section>
  );
}

export function DocParty({ label, name, lines, rows }: {
  label: string;
  name: ReactNode;
  lines?: ReactNode[];
  rows?: Array<[string, ReactNode]>;
}) {
  return (
    <div className="min-w-0">
      <DocLabel className="mb-1.5">{label}</DocLabel>
      <p className="text-md font-extrabold text-ink-700">{name}</p>
      {lines?.filter(Boolean).map((l, i) => (
        <p key={i} className="text-xs leading-[1.5] text-grey-500 mt-0.5">{l}</p>
      ))}
      {rows && rows.length > 0 && (
        <table className="mt-2">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pr-4 text-xs text-grey-500 whitespace-nowrap align-top">{k}</td>
                <td className="py-0.5 text-xs font-semibold text-ink-700">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A table's header cell: the voucher's label over a 2px ink rule. */
export const DOC_TH = "pb-1.5 border-b-2 border-ink-700 text-xs font-bold uppercase tracking-[0.08em] text-grey-500";
/** A table's body cell: on a hairline. */
export const DOC_TD = "py-2.5 border-b border-grey-200 text-sm align-top";

/** Label left, figure right; the last row, `total`, over a 2px ink rule. */
export function DocTotals({ rows, total, after, className }: {
  rows: Array<[ReactNode, ReactNode]>;
  total: [ReactNode, ReactNode];
  /** Quiet rows under the total: what was paid, what is left. */
  after?: Array<[ReactNode, ReactNode]>;
  className?: string;
}) {
  return (
    <table className={cn("min-w-[280px]", className)}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <td className="py-1 text-sm text-grey-500">{k}</td>
            <td className="py-1 pl-6 text-right text-sm font-semibold tabular whitespace-nowrap">{v}</td>
          </tr>
        ))}
        <tr><td colSpan={2} className="pt-1.5 border-t-2 border-ink-700" /></tr>
        <tr>
          <td className="py-1 text-sm font-bold text-ink-700">{total[0]}</td>
          <td className="py-1 pl-6 text-right text-md font-extrabold tabular whitespace-nowrap">{total[1]}</td>
        </tr>
        {after?.map(([k, v], i) => (
          <tr key={`a${i}`}>
            <td className="py-0.5 text-sm text-grey-500">{k}</td>
            <td className="py-0.5 pl-6 text-right text-sm text-grey-500 tabular whitespace-nowrap">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The one block a reader must not miss, orange-edged (the voucher's
    "Confirmed by the hotel"). */
export function DocPanel({ label, children, className }: {
  label?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-grey-200 border-l-4 border-l-accent-from bg-brand-orange-50 px-3.5 py-3", className)}>
      {label && <DocLabel className="text-brand-orange-700 mb-1.5">{label}</DocLabel>}
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Who issued it, over a 2px ink rule; `note` is the closing line. */
export function DocFooter({ name, left, right, note }: {
  name: string;
  left?: ReactNode;
  right?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <footer className="mt-6">
      <div className="grid grid-cols-2 gap-6 border-t-2 border-ink-700 pt-2.5">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-ink-700">{name}</p>
          {left && <div className="text-xs leading-[1.55] text-grey-500 mt-1">{left}</div>}
        </div>
        <div className="text-right text-xs leading-[1.7] text-grey-500">{right}</div>
      </div>
      {note && <p className="mt-3.5 text-center text-xs text-grey-500">{note}</p>}
    </footer>
  );
}
