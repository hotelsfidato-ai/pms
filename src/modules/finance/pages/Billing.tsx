import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Building2, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, DataTable, StatusPill, Skeleton, EmptyState, FigureRow, FigureTile,
  type Column,
} from "@/components/ui";
import { listPayments, paymentsByMethod, type PaymentRow } from "@/modules/finance/data/billing";
import { BUSINESS_DATE, PTD_FROM } from "@/data/repositories";
import { getReport } from "@/modules/reports";

/* ══════════════════════════════════════════════════════════════════
   PAYMENTS · INVOICES · CITY LEDGER

   Three views of money, at three distances. Payments is the day's
   receipts as they landed. Invoices is what is ready to be billed.
   City ledger is what has walked out of the building unsettled.
   ══════════════════════════════════════════════════════════════════ */

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Payments ────────────────────────────────────────────────────── */

const PAYMENT_COLUMNS: Column<PaymentRow>[] = [
  {
    key: "at", header: "Taken", width: "w-[150px]",
    cell: (p) => <span className="tabular text-grey-600">{dateTime(p.at)}</span>,
  },
  {
    key: "guest", header: "Guest",
    cell: (p) => (
      <div className="min-w-0">
        <p className={cn("truncate", p.reversed && "line-through text-grey-500")}>{p.guest}</p>
        <p className="text-2xs text-grey-500 tabular">
          room {p.roomNumber} · {p.reference}
        </p>
      </div>
    ),
  },
  {
    key: "method", header: "Method",
    /* "Reversed" in words (QA FI-18): the strike-through alone was easy to miss. */
    cell: (p) => (
      <span className="inline-flex flex-wrap gap-1">
        <StatusPill tone={p.reversed ? "neutral" : "info"}>{p.method}</StatusPill>
        {p.reversed && <StatusPill tone="neutral">Reversed</StatusPill>}
      </span>
    ),
  },
  {
    key: "description", header: "Narration", hideBelow: "lg",
    cell: (p) => <span className="text-grey-600 truncate">{p.description}</span>,
  },
  {
    key: "user", header: "Taken by", hideBelow: "xl",
    cell: (p) => <span className="text-grey-600">{p.user ?? "-"}</span>,
  },
  {
    key: "amount", header: "Amount", numeric: true,
    cell: (p) => (
      <span className={cn("tabular font-medium", p.reversed ? "line-through text-grey-500" : "text-ink-900")}>
        {money(p.amount)}
      </span>
    ),
  },
];

export function PaymentsPage() {
  const hotelId = useHotel();

  const rows = useQuery({
    queryKey: ["payments", hotelId],
    queryFn: () => listPayments(hotelId),
  });
  const byMethod = useQuery({
    queryKey: ["payments-by-method", hotelId],
    queryFn: () => paymentsByMethod(hotelId),
  });

  const total = (byMethod.data ?? []).reduce((t, m) => t + m.amount, 0);
  const reversedCount = (rows.data ?? []).filter((r) => r.reversed).length;

  return (
    <Page>
      <PageHeader
        title="Payments"
        description="Every receipt against a folio, newest first. Reversed receipts stay on the list."
      />

      {byMethod.isLoading ? (
        <Skeleton className="h-24 w-full mb-5" />
      ) : (
        /* One tile per way of paying, then the total, on the Figure Rule. */
        <FigureRow className="sm:grid-cols-2 lg:grid-cols-4 mb-5">
          {(byMethod.data ?? []).map((m) => (
            <FigureTile
              key={m.method}
              icon={<Wallet />}
              label={m.method}
              value={money(m.amount)}
              note={`${m.count} receipt${m.count === 1 ? "" : "s"}`}
            />
          ))}
          <FigureTile
            icon={<Wallet />} tone="green"
            label="Total received"
            value={money(total)}
            note="Reversals excluded"
            className="bg-grey-50"
          />
        </FigureRow>
      )}

      <Card>
        <DataTable<PaymentRow>
          rows={rows.data ?? []}
          columns={PAYMENT_COLUMNS}
          rowKey={(p) => p.id}
          loading={rows.isLoading}
          error={rows.error}
          onRetry={() => rows.refetch()}
          empty={
            <EmptyState compact icon={<Wallet />} title="No payments yet"
              description="Each payment taken on a guest's folio is listed here as it is taken." />
          }
        />
      </Card>

      {reversedCount > 0 && (
        <p className="text-xs text-grey-500 mt-4 leading-relaxed">
          {reversedCount} receipt{reversedCount === 1 ? " is" : "s are"} marked Reversed.
          The ledger is append-only, so a reversal is its own line and the original
          stays where it was - a receipt that disappeared is a receipt somebody would
          go looking for.
        </p>
      )}
    </Page>
  );
}

/* Invoices moved to Invoices.tsx, beside this file, when issuing landed. Three
   screens in one file was already a stretch; a fourth carrying a
   mutation was not. BILL_TONE, BILL_LABEL and the billable columns went
   with it — they described that page and nothing else here. */

/* InvoicesPage moved to Invoices.tsx, beside this file, when issuing landed —
   see the note on the import in App.tsx. */

/* ── City ledger, at the property ────────────────────────────────── */

/* ONE FIGURE FOR A COMPANY, EVERYWHERE (the owner's D27-127, QA FI-2): this
   screen showed each booking source's whole stays - every charge less every
   payment, the guest's own included - so Agoda owed ₹0 here while the City
   ledger report said ₹5,999.70 had been sent to it "Bill to company". It now
   shows that report's own figures, read through reports' door: what was sent
   to each company or booking site in the period. What each has paid back is
   not recorded by this system yet, so Received and Balance are a dash - the
   report's rule, never a zero. */
interface LedgerRow { account: string; debit: number }

const LEDGER_COLUMNS: Column<LedgerRow>[] = [
  { key: "account", header: "Account", cell: (r) => <span className="font-medium">{r.account}</span> },
  { key: "debit", header: "Sent to the account", numeric: true, cell: (r) => <span className="tabular">{money(r.debit)}</span> },
  { key: "credit", header: "Received", numeric: true, cell: () => <span className="text-grey-500">-</span> },
  { key: "closing", header: "Balance", numeric: true, cell: () => <span className="text-grey-500">-</span> },
];

export function PropertyCityLedgerPage() {
  const hotelId = useHotel();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["city-ledger", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getReport(hotelId, "city-ledger", { from: PTD_FROM, asOn: BUSINESS_DATE }),
  });

  const section = data?.sections.find((s) => s.key === "accounts");
  const rows: LedgerRow[] = (section?.rows ?? [])
    .filter((r) => r.kind === "row")
    .map((r) => ({ account: String(r.cells["account"] ?? "-"), debit: Number(r.cells["debit"] ?? 0) }));
  const sent = rows.reduce((t, r) => t + r.debit, 0);

  return (
    <Page>
      <PageHeader
        title="Company accounts"
        description={`Bills sent to a company or booking site, ${dateLong(PTD_FROM)} to ${dateLong(BUSINESS_DATE)}.`}
        badge={data ? <StatusPill tone={sent ? "warning" : "success"}>{money(sent)} sent to accounts</StatusPill> : undefined}
      />
      <Card>
        <DataTable<LedgerRow>
          rows={rows}
          columns={LEDGER_COLUMNS}
          rowKey={(r) => r.account}
          loading={isLoading}
          error={error}
          empty={
            <EmptyState compact icon={<Building2 />} title="Nothing sent to an account yet"
              description={"Each company, agent and booking site shows here once a bill is settled \"Bill to company\"."} />
          }
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        The same figures as the City ledger report under Reports. Received and Balance
        show "-": this system does not record a company's payment yet.
      </p>
    </Page>
  );
}
