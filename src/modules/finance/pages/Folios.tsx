import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ArrowDown, ArrowUp, ReceiptText, Scale } from "lucide-react";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, FigureRow, FigureTile, StatusPill, Term } from "@/components/ui";
import { StayTable, type StayColumn, type StayRow } from "@/modules/front-desk";
import { listGroupBills, listOpenFolios } from "@/modules/finance/data/folios";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   FOLIOS

   Every account still carrying a balance — in both directions.
   Overpayments are money the property owes back, and they are easier
   to lose than debts because nobody chases them. They sort to the top
   for that reason.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: StayColumn[] = [
  "room", "guest", "type", "arrival", "departure", "status", "balance",
];

export default function FoliosPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const folios = useQuery({
    queryKey: queryKeys.openFolios(hotelId),
    queryFn: () => listOpenFolios(hotelId),
  });

  /* A GROUP'S MASTER BILL (the owner's D27-226): the company's nights are
     on it, listed once under the group's name - never under each guest. */
  const groups = useQuery({
    queryKey: [...queryKeys.openFolios(hotelId), "groups"],
    queryFn: () => listGroupBills(hotelId),
  });

  /* `listOpenFolios` sorts by balance ascending, so overpayments —
     which are negative — already come first. */
  const rows: StayRow[] = (folios.data ?? []).map((f) => ({
    ...f.stay,
    balance: f.balance,
  }));

  const all = [...rows.map((r) => r.balance ?? 0), ...(groups.data ?? []).map((g) => g.balance)];
  const owed = all.filter((b) => b > 0);
  const overpaid = all.filter((b) => b < 0);
  const owedTotal = owed.reduce((t, b) => t + b, 0);
  const overpaidTotal = overpaid.reduce((t, b) => t + Math.abs(b), 0);

  return (
    <Page>
      <PageHeader
        title="Folios"
        description={<>Open <Term name="folio">folios</Term>. A charge is never edited - a wrong posting is reversed, and the reversal is its own line.</>}
        badge={
          folios.data ? (
            <StatusPill tone={all.length ? "warning" : "success"}>
              {all.length} open
            </StatusPill>
          ) : undefined
        }
      />

      {/* The Figure Rule: label with its chip, the figure, its note; money
          to collect is warm while there is some. */}
      <FigureRow className="sm:grid-cols-3 mb-5">
        <FigureTile
          icon={<ReceiptText />} tone={owedTotal > 0 ? "orange" : "neutral"}
          label="Outstanding"
          value={money(owedTotal)}
          note={`${owed.length} folio${owed.length === 1 ? "" : "s"} owing`}
        />
        <FigureTile
          icon={<ArrowDown />} tone={overpaidTotal > 0 ? "blue" : "neutral"}
          label="Overpaid"
          value={money(overpaidTotal)}
          note={
            overpaid.length
              ? `${overpaid.length} refund${overpaid.length === 1 ? "" : "s"} due`
              : "Nothing to refund"
          }
        />
        <FigureTile
          icon={<Scale />}
          label="Net position"
          value={money(owedTotal - overpaidTotal)}
          note="Owed to the property, less refunds"
        />
      </FigureRow>

      {overpaid.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-info-100 bg-info-50 px-4 py-3.5 mb-5">
          <ArrowDown className="size-4 text-info shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">
              {overpaid.length} guest{overpaid.length === 1 ? "" : "s"} overpaid,{" "}
              <span className="tabular">{money(overpaidTotal)}</span> to return
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              Money owed outward. Nobody chases these, so they sort first.
            </p>
          </div>
        </div>
      )}

      <StayTable
        hotelId={hotelId}
        businessDate={BUSINESS_DATE}
        rows={rows}
        isLoading={folios.isLoading}
        error={folios.error}
        onRetry={() => folios.refetch()}
        columns={COLUMNS}
        defaultTab="folio"
        emptyTitle="Every folio is settled"
        emptyBody="Nothing outstanding, and nothing to refund."
      />

      {(groups.data ?? []).length > 0 && (
        <section className="mt-5 rounded-lg border border-grey-200 overflow-hidden" data-group-bills>
          <p className="bg-grey-50 border-b border-grey-200 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-grey-500">
            Group bills
          </p>
          <ul className="divide-y divide-grey-100">
            {groups.data!.map((g) => (
              <li key={g.groupId} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <Link to={`/h/${hotelId}/groups/${g.groupId}`} className="text-ink-900 underline-offset-2 hover:underline">
                  {g.group ?? "A group"}
                </Link>
                <span className={g.balance < 0 ? "tabular text-info" : "tabular font-medium text-ink-900"}>
                  {g.balance < 0 ? "−" : ""}{money(Math.abs(g.balance))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
        <ArrowUp className="size-3.5 shrink-0 mt-0.5" />
        <span>
          A positive balance is owed by the guest; a negative one is owed to them.
          Both are real and both print - neither is hidden or shown as zero.
        </span>
      </p>
    </Page>
  );
}
