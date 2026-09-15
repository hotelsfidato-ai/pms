import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, CardBody, Stat, StatusPill, Term } from "@/components/ui";
import { StayTable, type StayColumn, type StayRow } from "@/components/lists/StayTable";
import { listOpenFolios, queryKeys, BUSINESS_DATE } from "@/data/repositories";

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

  /* `listOpenFolios` sorts by balance ascending, so overpayments —
     which are negative — already come first. */
  const rows: StayRow[] = (folios.data ?? []).map((f) => ({
    ...f.stay,
    balance: f.balance,
  }));

  const owed = rows.filter((r) => (r.balance ?? 0) > 0);
  const overpaid = rows.filter((r) => (r.balance ?? 0) < 0);
  const owedTotal = owed.reduce((t, r) => t + (r.balance ?? 0), 0);
  const overpaidTotal = overpaid.reduce((t, r) => t + Math.abs(r.balance ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Folios"
        description={<>Open <Term name="folio">folios</Term>. A charge is never edited — a wrong posting is reversed, and the reversal is its own line.</>}
        badge={
          folios.data ? (
            <StatusPill tone={rows.length ? "warning" : "success"}>
              {rows.length} open
            </StatusPill>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <Card>
          <CardBody>
            <Stat
              label="Outstanding"
              value={money(owedTotal)}
              hint={`${owed.length} folio${owed.length === 1 ? "" : "s"} owing`}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Overpaid"
              value={money(overpaidTotal)}
              hint={
                overpaid.length
                  ? `${overpaid.length} refund${overpaid.length === 1 ? "" : "s"} due`
                  : "Nothing to refund"
              }
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Net position"
              value={money(owedTotal - overpaidTotal)}
              hint="Owed to the property, less refunds"
            />
          </CardBody>
        </Card>
      </div>

      {overpaid.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-info-100 bg-info-50 p-3.5 mb-4">
          <ArrowDown className="size-4 text-info shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900">
              {overpaid.length} guest{overpaid.length === 1 ? "" : "s"} overpaid,{" "}
              <span className="tabular">{money(overpaidTotal)}</span> to return
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              Money owed outward. Nobody chases these, so they sort first.
            </p>
          </div>
        </div>
      )}

      <Card className="p-4">
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
      </Card>

      <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
        <ArrowUp className="size-3.5 shrink-0 mt-0.5" />
        <span>
          A positive balance is owed by the guest; a negative one is owed to them.
          Both are real and both print — neither is hidden or shown as zero.
        </span>
      </p>
    </Page>
  );
}
