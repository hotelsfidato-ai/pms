import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { FileText, Receipt } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, dateTime, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill, Skeleton,
  type Column, type Tone,
} from "@/components/ui";
import {
  listPayments, paymentsByMethod, listBillable, getInvoiceSeries,
  getCityLedger, PTD_FROM, BUSINESS_DATE,
  type PaymentRow, type BillableRow, type CityLedgerRow,
} from "@/data/repositories";

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

/* ── Invoices ────────────────────────────────────────────────────── */

const BILL_TONE: Record<BillableRow["status"], Tone> = {
  settled: "success",
  outstanding: "danger",
  overpaid: "info",
};

const BILL_LABEL: Record<BillableRow["status"], string> = {
  settled: "Ready to bill",
  outstanding: "Balance due",
  overpaid: "Refund due",
};

const BILLABLE_COLUMNS: Column<BillableRow>[] = [
  {
    key: "guest", header: "Guest",
    cell: (b) => (
      <div className="min-w-0">
        <p className="truncate">{b.guest}</p>
        <p className="text-2xs text-grey-500 tabular">
          room {b.roomNumber} · {b.reference}
        </p>
      </div>
    ),
  },
  {
    key: "stay", header: "Stay", hideBelow: "md",
    cell: (b) => (
      <span className="tabular text-grey-600">
        {dateShort(b.arrival)} – {dateShort(b.departure)}
      </span>
    ),
  },
  { key: "nights", header: "Nights", numeric: true, hideBelow: "sm", cell: (b) => <span className="tabular">{b.nights}</span> },
  { key: "charges", header: "Charges", numeric: true, cell: (b) => <span className="tabular">{money(b.charges)}</span> },
  { key: "tax", header: "Tax", numeric: true, hideBelow: "lg", cell: (b) => <span className="tabular">{money(b.tax)}</span> },
  { key: "paid", header: "Received", numeric: true, cell: (b) => <span className="tabular">{money(b.paid)}</span> },
  {
    key: "status", header: "Status",
    cell: (b) => (
      <StatusPill tone={BILL_TONE[b.status]}>
        {BILL_LABEL[b.status]}
        {b.status !== "settled" && ` ${money(Math.abs(b.balance))}`}
      </StatusPill>
    ),
  },
];

export function InvoicesPage() {
  const hotelId = useHotel();

  const rows = useQuery({
    queryKey: ["billable", hotelId],
    queryFn: () => listBillable(hotelId),
  });
  const series = useQuery({
    queryKey: ["invoice-series", hotelId],
    queryFn: () => getInvoiceSeries(hotelId),
  });

  const ready = (rows.data ?? []).filter((b) => b.status === "settled").length;

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description="Departed stays and what each is owed or owes. Nothing here has been issued a number."
        badge={
          rows.data ? (
            <StatusPill tone={ready ? "success" : "neutral"}>{ready} ready to bill</StatusPill>
          ) : undefined
        }
      />

      <div className="flex items-start gap-3 rounded-md border border-grey-200 bg-grey-50 p-3.5 mb-5">
        <FileText className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">No invoice number has been issued</p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            The series below is the hotel's real GST sequence. A number shown here but
            never printed on a filed return leaves a hole in that sequence, and a hole
            in a GST series is a question from an assessor. Issuing moves to this screen
            at Stage 8, when the numbers are recorded rather than displayed.
          </p>
          {series.data && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2.5">
              {series.data.map((s) => (
                <div key={s.prefix}>
                  <span className="text-2xs text-grey-500">{s.prefix} — next </span>
                  <span className="text-sm tabular font-medium text-ink-900">{s.next}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card>
        <DataTable<BillableRow>
          rows={rows.data ?? []}
          columns={BILLABLE_COLUMNS}
          rowKey={(b) => b.stayId}
          loading={rows.isLoading}
          error={rows.error}
          onRetry={() => rows.refetch()}
          empty={
            <div className="text-center py-10">
              <Receipt className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">Nothing has departed yet</p>
              <p className="text-base text-grey-500 mt-1.5">
                A folio becomes billable when the guest checks out.
              </p>
            </div>
          }
        />
      </Card>
    </Page>
  );
}

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
        title="City ledger"
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
