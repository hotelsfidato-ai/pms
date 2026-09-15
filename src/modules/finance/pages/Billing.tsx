import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Building2, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill, Skeleton, EmptyState,
  type Column,
} from "@/components/ui";
import { listPayments, paymentsByMethod, type PaymentRow } from "@/modules/finance/data/billing";
import { BUSINESS_DATE, PTD_FROM } from "@/data/repositories";
import { getCityLedger, type CityLedgerRow } from "@/modules/reports";

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
        <p className={cn("truncate", p.reversed && "line-through text-grey-400")}>{p.guest}</p>
        <p className="text-2xs text-grey-500 tabular">
          room {p.roomNumber} · {p.reference}
        </p>
      </div>
    ),
  },
  {
    key: "method", header: "Method",
    cell: (p) => <StatusPill tone={p.reversed ? "neutral" : "info"}>{p.method}</StatusPill>,
  },
  {
    key: "description", header: "Narration", hideBelow: "lg",
    cell: (p) => <span className="text-grey-600 truncate">{p.description}</span>,
  },
  {
    key: "user", header: "Taken by", hideBelow: "xl",
    cell: (p) => <span className="text-grey-600">{p.user}</span>,
  },
  {
    key: "amount", header: "Amount", numeric: true,
    cell: (p) => (
      <span className={cn("tabular font-medium", p.reversed ? "line-through text-grey-400" : "text-ink-900")}>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
          {(byMethod.data ?? []).map((m) => (
            <Card key={m.method}>
              <CardBody>
                <p className="text-sm text-grey-500">{m.method}</p>
                <p className="text-lg font-semibold text-ink-900 tabular mt-1">{money(m.amount)}</p>
                <p className="text-2xs text-grey-400 tabular mt-0.5">
                  {m.count} receipt{m.count === 1 ? "" : "s"}
                </p>
              </CardBody>
            </Card>
          ))}
          <Card className="bg-grey-50">
            <CardBody>
              <p className="text-sm text-grey-500">Total received</p>
              <p className="text-lg font-semibold text-ink-900 tabular mt-1">{money(total)}</p>
              <p className="text-2xs text-grey-400 mt-0.5">Reversals excluded</p>
            </CardBody>
          </Card>
        </div>
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
          {reversedCount} receipt{reversedCount === 1 ? " is" : "s are"} struck through.
          The ledger is append-only, so a reversal is its own line and the original
          stays where it was — a receipt that disappeared is a receipt somebody would
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

const LEDGER_COLUMNS: Column<CityLedgerRow>[] = [
  { key: "account", header: "Account", cell: (r) => <span className="font-medium">{r.account}</span> },
  {
    key: "opening", header: "Opening", numeric: true, hideBelow: "md",
    cell: (r) =>
      r.opening === null
        ? <span className="text-grey-400" title="Nothing predates this window">—</span>
        : <span className="tabular">{money(r.opening)}</span>,
  },
  { key: "debit", header: "Charged", numeric: true, cell: (r) => <span className="tabular">{money(r.debit)}</span> },
  { key: "credit", header: "Received", numeric: true, cell: (r) => <span className="tabular">{money(r.credit)}</span> },
  {
    key: "closing", header: "Balance", numeric: true,
    cell: (r) =>
      r.closing === null ? <span className="text-grey-400">—</span> : (
        <span className={cn("tabular font-medium", r.closing > 0 ? "text-brand-red" : r.closing < 0 ? "text-info" : "text-grey-400")}>
          {r.closing === 0 ? "—" : money(Math.abs(r.closing))}
        </span>
      ),
  },
];

export function PropertyCityLedgerPage() {
  const hotelId = useHotel();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["city-ledger", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getCityLedger(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const owed = (data ?? []).reduce((t, r) => t + Math.max(r.closing ?? 0, 0), 0);

  return (
    <Page>
      <PageHeader
        title="Company accounts"
        description={`Balances by booking source, ${dateLong(PTD_FROM)} to ${dateLong(BUSINESS_DATE)}.`}
        badge={data ? <StatusPill tone={owed ? "warning" : "success"}>{money(owed)} outstanding</StatusPill> : undefined}
      />
      <Card>
        <DataTable<CityLedgerRow>
          rows={data ?? []}
          columns={LEDGER_COLUMNS}
          rowKey={(r) => r.account}
          loading={isLoading}
          error={error}
          empty={
            <EmptyState compact icon={<Building2 />} title="Nothing posted yet"
              description="Each company, agent and booking site shows here once a stay booked through it has a charge or a payment." />
          }
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        A negative balance means the account is in credit — the source has paid ahead
        of what it has been charged. That is normal for an OTA and is shown as it is,
        not flattened to zero. The printable version lives under Reports.
      </p>
    </Page>
  );
}
