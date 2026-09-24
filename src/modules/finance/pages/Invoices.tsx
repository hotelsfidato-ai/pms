import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { FileText, Receipt, FileCheck2, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill,
  Button, Tooltip, type Column,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { listBillable, getInvoiceSeries, listInvoices, issueInvoice, listVatBills, type BillableRow, type IssuedInvoice, type IssuedVatBill } from "@/modules/finance/data/billing";
import { TaxRulesCard } from "@/modules/finance/flows/TaxRulesCard";

/* ══════════════════════════════════════════════════════════════════
   INVOICES

   This screen carried a notice for eight checkpoints:

     "Issuing moves to this screen at Stage 8, when the numbers are
      recorded rather than displayed."

   That was the removal condition, written when the limitation was
   added, and Stage 8 met it. The notice is gone and the button works.

   WHY THE OLD NOTICE WAS RIGHT TO EXIST

   A number shown on a screen but never recorded leaves a hole in the
   hotel's GST series, and a hole in a GST series is a question from an
   assessor. So nothing here generates a number for display: the number
   is allocated and written against the folio in one transaction, or
   not at all.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Ready to bill ────────────────────────────────────────────────── */

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
    key: "nights", header: "Nights", numeric: true, hideBelow: "sm",
    cell: (b) => <span className="tabular">{b.nights}</span>,
  },
  {
    key: "charges", header: "Charges", numeric: true,
    cell: (b) => <span className="tabular">{money(b.charges)}</span>,
  },
  {
    key: "tax", header: "Tax", numeric: true, hideBelow: "lg",
    cell: (b) => <span className="tabular">{money(b.tax)}</span>,
  },
  {
    key: "balance", header: "Balance", numeric: true,
    cell: (b) => (
      <span className={cn("tabular", b.balance !== 0 && "text-brand-red font-medium")}>
        {b.balance === 0 ? "-" : money(b.balance)}
      </span>
    ),
  },
];

/* ── Issued ───────────────────────────────────────────────────────── */

function issuedColumns(hotelId: string): Column<IssuedInvoice>[] {
  return [
  {
    key: "number", header: "Number",
    cell: (i) => (
      <div className="min-w-0">
        <Link
          to={`/h/${hotelId}/invoices/doc/${i.number}`}
          className="tabular font-medium truncate text-brand hover:underline"
        >
          {i.number}
        </Link>
        {i.isCreditNote && <p className="text-2xs text-brand-red">credit note</p>}
      </div>
    ),
  },
  {
    key: "recipient", header: "Billed to",
    cell: (i) => <span className="truncate">{i.recipient ?? "-"}</span>,
  },
  {
    key: "issued", header: "Issued", hideBelow: "md",
    cell: (i) => <span className="tabular text-grey-600">{i.issuedAt}</span>,
  },
  {
    key: "tax", header: "Tax", numeric: true, hideBelow: "lg",
    cell: (i) => <span className="tabular">{money(i.taxTotal)}</span>,
  },
  {
    key: "total", header: "Total", numeric: true,
    cell: (i) => (
      <span className={cn("tabular font-medium", i.total < 0 && "text-brand-red")}>
        {money(i.total)}
      </span>
    ),
  },
  {
    key: "state", header: "",
    cell: (i) =>
      i.creditedBy ? (
        /* Not hidden, and not silently struck through. A credited
           invoice still exists and still holds its number; what
           changed is that another document cancels it. */
        <Tooltip content={`Cancelled by ${i.creditedBy}`}>
          <span><StatusPill tone="warning">credited</StatusPill></span>
        </Tooltip>
      ) : i.isCreditNote ? (
        <span className="text-2xs text-grey-500">-</span>
      ) : (
        <StatusPill tone="success">issued</StatusPill>
      ),
  },
  ];
}

/* ── VAT bills for alcohol (D22-44) ────────────────────────────────── */

function vatColumns(hotelId: string): Column<IssuedVatBill>[] {
  return [
    {
      key: "number", header: "Number",
      cell: (v) => (
        <div className="min-w-0">
          <Link
            to={`/h/${hotelId}/invoices/vat/${v.number}`}
            className="tabular font-medium truncate text-brand hover:underline"
          >
            {v.number}
          </Link>
          {v.isCancellation && <p className="text-2xs text-brand-red">credit note</p>}
        </div>
      ),
    },
    {
      key: "recipient", header: "Billed to",
      cell: (v) => <span className="truncate">{v.recipient ?? "-"}</span>,
    },
    {
      key: "issued", header: "Issued", hideBelow: "md",
      cell: (v) => <span className="tabular text-grey-600">{v.issuedAt}</span>,
    },
    {
      key: "vat", header: "VAT", numeric: true, hideBelow: "lg",
      cell: (v) => <span className="tabular">{money(v.vatTotal)}</span>,
    },
    {
      key: "total", header: "Total", numeric: true,
      cell: (v) => (
        <span className={cn("tabular font-medium", v.total < 0 && "text-brand-red")}>
          {money(v.total)}
        </span>
      ),
    },
    {
      key: "state", header: "",
      cell: (v) =>
        v.cancelledBy ? (
          <Tooltip content={`Cancelled by ${v.cancelledBy}`}>
            <span><StatusPill tone="warning">cancelled</StatusPill></span>
          </Tooltip>
        ) : v.isCancellation ? (
          <span className="text-2xs text-grey-500">-</span>
        ) : (
          <StatusPill tone="success">issued</StatusPill>
        ),
    },
  ];
}

export default function InvoicesPage() {
  const hotelId = useHotel();
  const role = useRole();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ number: string; vatBill?: string | null } | null>(null);

  const rows = useQuery({
    queryKey: ["billable", hotelId],
    queryFn: () => listBillable(hotelId),
  });
  const series = useQuery({
    queryKey: ["invoice-series", hotelId],
    queryFn: () => getInvoiceSeries(hotelId),
  });
  const invoices = useQuery({
    queryKey: ["invoices", hotelId],
    queryFn: () => listInvoices(hotelId),
  });
  const vatBills = useQuery({
    queryKey: ["vat-bills", hotelId],
    queryFn: () => listVatBills(hotelId),
  });

  const issue = useMutation({
    mutationFn: (stayId: string) => issueInvoice(hotelId, stayId),
    onSuccess: async (r) => {
      if (r.number) setIssued({ number: r.number, vatBill: r.vatBill });
      /* The series advanced and the issued list gained a row. */
      await queryClient.invalidateQueries();
    },
  });

  const ready = (rows.data ?? [])
    .filter((b) => b.status === "settled" && !b.invoice).length;

  /* Built here rather than at module level because it needs the
     mutation. Rule 6: a stay that cannot be invoiced shows a DISABLED
     button carrying its reason, never a missing one. */
  const columns: Column<BillableRow>[] = [
    ...BILLABLE_COLUMNS,
    {
      key: "issue", header: "",
      cell: (b) => {
        /* Already billed. The row keeps its place so the stay stays
           linked to its number — hiding it would make a clerk hunt for
           where the invoice went. */
        if (b.invoice) {
          return (
            <Link
              to={`/h/${hotelId}/invoices/doc/${b.invoice}`}
              className="tabular text-2xs text-brand hover:underline"
            >
              {b.invoice}
            </Link>
          );
        }
        const reason =
          b.status === "outstanding"
            ? "The folio still carries a balance. Settle it, or transfer it to the city ledger, before invoicing."
            : b.status === "overpaid"
              ? "The folio is overpaid. Refund the difference before invoicing."
              : "";
        return (
          <Tooltip content={reason}>
            <span>
              <Button
                size="sm"
                variant="secondary"
                disabled={b.status !== "settled" || issue.isPending}
                onClick={() => issue.mutate(b.stayId)}
              >
                Issue
              </Button>
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description="Departed stays ready to bill, and every number this property has issued."
        badge={
          rows.data ? (
            <StatusPill tone={ready ? "success" : "neutral"}>
              {ready} ready to bill
            </StatusPill>
          ) : undefined
        }
      />

      {/* ── E-INVOICING · named, not silent ────────────────────────
          The group turns over under ₹5 crore, so registering each B2B
          invoice with the IRP for an IRN and a signed QR is NOT
          required of it. That was asked and answered.

          But an absence is not an answer to the person looking for it.
          An accountant who knows the rule, or an assessor, or the owner
          on the day the group crosses the threshold, all come to this
          screen and find nothing about IRNs at all — and nothing reads
          as "this system cannot", not as "this hotel need not".

          Rule 6 for features: a thing that is not done is SHOWN with
          its reason, and with the condition that would change the
          answer. That condition is a number the owner will know before
          anybody else does. */}
      <div className="flex items-start gap-3 rounded-md border border-grey-200
                      bg-grey-50 p-3.5 mb-3">
        <Clock className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            E-invoicing (IRN and signed QR) - coming soon
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Not required of this group: registering each B2B invoice with
            the government portal begins above ₹5 crore of annual
            turnover, and Fidato is under it. Invoices issued here are
            complete and valid GST invoices without an IRN.
            <strong className="font-medium text-ink-900">
              {" "}Tell us the year this group crosses ₹5 crore
            </strong>{" "}
            - from the April after that, every B2B invoice needs an IRN
            before it reaches the guest, and this is where it will appear.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-grey-200 bg-grey-50 p-3.5 mb-5">
        <FileText className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            Numbers come from the database, in sequence
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            The number is allocated and written against the folio in one
            transaction, so the GST series cannot gain a hole. An issued
            invoice is never edited - a wrong one is corrected with a credit
            note carrying its own number, and both remain.
          </p>
          {series.data && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2.5">
              {series.data.map((s) => (
                <div key={`${s.prefix}-${s.finYear}`}>
                  <span className="text-2xs text-grey-500">
                    {s.finYear} - next{" "}
                  </span>
                  <span className="text-sm tabular font-medium text-ink-900">
                    {s.next}
                  </span>
                  <span className="text-2xs text-grey-500"> · {s.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {issue.isError && (
        <Card className="mb-4 border-red-200 bg-red-50/50">
          <CardBody>
            <p className="text-sm text-red-900">
              {describeError(issue.error).message ??
                "The invoice was not issued. Nothing was changed."}
            </p>
          </CardBody>
        </Card>
      )}

      {issued && (
        <Card className="mb-4 border-green-200 bg-green-50/50">
          <CardBody className="flex items-center gap-2.5">
            <FileCheck2 className="size-4 text-green-700 shrink-0" />
            <p className="text-sm text-green-900">
              Issued <span className="tabular font-medium">{issued.number}</span>
              {issued.vatBill && (
                <>, and VAT bill <span className="tabular font-medium">{issued.vatBill}</span> for the alcohol</>
              )}
              .
            </p>
          </CardBody>
        </Card>
      )}

      <Card className="mb-7">
        <DataTable<BillableRow>
          rows={rows.data ?? []}
          columns={columns}
          rowKey={(b) => b.stayId}
          loading={rows.isLoading}
          error={rows.error}
          onRetry={() => rows.refetch()}
          empty={
            <div className="text-center py-10">
              <Receipt className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                Nothing has departed yet
              </p>
              <p className="text-base text-grey-500 mt-1.5">
                A folio becomes billable when the guest checks out.
              </p>
            </div>
          }
        />
      </Card>

      <PageHeader
        title="Issued"
        description="Every number allocated at this property, newest first. A credit note sits beside the invoice it cancels."
      />

      <Card>
        <DataTable<IssuedInvoice>
          rows={invoices.data ?? []}
          columns={issuedColumns(hotelId)}
          rowKey={(i) => i.number}
          loading={invoices.isLoading}
          error={invoices.error}
          onRetry={() => invoices.refetch()}
          empty={
            <div className="text-center py-10">
              <FileText className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No invoice has been issued
              </p>
              <p className="text-base text-grey-500 mt-1.5">
                The series above is waiting at its first number.
              </p>
            </div>
          }
        />
      </Card>

      {/* D22-44: only where a hotel has issued one - a hotel that serves no
          alcohol has none, and an empty table would be noise. */}
      {(vatBills.data?.length ?? 0) > 0 && (
        <>
          <div className="mt-7">
            <PageHeader
              title="VAT bills"
              description="Alcohol, billed under VAT from its own series, each beside the GST document of the same sale."
            />
          </div>
          <Card>
            <DataTable<IssuedVatBill>
              rows={vatBills.data ?? []}
              columns={vatColumns(hotelId)}
              rowKey={(v) => v.number}
            />
          </Card>
        </>
      )}

      {/* D23-1: the accountant sets GST and VAT here - the same card as on
          Room types, which the accountant cannot open. Shown to the four who
          may set a rate (D22-32), the server's own rule (roleGate.ts `GST`);
          reception, the hotel manager and the viewer are not shown a Save
          the server would refuse (the owner, 24 September). */}
      {(can(role, "edit", "room_config") || role === "finance") && (
        <div className="mt-7">
          <TaxRulesCard hotelId={hotelId} />
        </div>
      )}
    </Page>
  );
}
