import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Building2, Plus } from "lucide-react";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, DataTable, EmptyState, Button, StatusPill, type Column,
} from "@/components/ui";
import { listCompanyRecords, KIND_LABEL, type CompanyRow } from "@/modules/contracts/data/contracts";
import { CompanyDialog } from "@/modules/contracts/components/CompanyDialog";
import { ExportButtons, type ExportColumn } from "@/modules/reports";

/* ══════════════════════════════════════════════════════════════════
   CONTRACTS (D27-178, D27-184): the group's companies and agents, each
   with its contract at this hotel today. A row opens the company. The
   owner, an administrator and the GM keep them; reception adds a company
   (C-7); whoever reads companies reads this (C-6).
   ══════════════════════════════════════════════════════════════════ */

/** "Allowed · 30 days · ₹5,00,000"; a figure not set is a dash. */
export const creditLine = (c: { creditAllowed: boolean; creditDays: number | null; creditLimit: number | null }) =>
  c.creditAllowed
    ? `Allowed · ${c.creditDays === null ? "-" : `${c.creditDays} days`} · ${c.creditLimit === null ? "-" : money(c.creditLimit)}`
    : "No";

const COLUMNS: Column<CompanyRow>[] = [
  { key: "name", header: "Company", cell: (c) => (
    <span className="flex items-center gap-2 min-w-0">
      <span className="font-medium truncate">{c.name}</span>
      {c.kind === "travel_agent" && <StatusPill tone="neutral">{KIND_LABEL[c.kind]}</StatusPill>}
    </span>
  ) },
  { key: "gstin", header: "GSTIN", hideBelow: "md",
    cell: (c) => <span className="tabular text-grey-700">{c.gstin ?? "-"}</span> },
  { key: "city", header: "City", hideBelow: "lg", cell: (c) => c.city ?? "-" },
  { key: "credit", header: "Credit", hideBelow: "lg", cell: (c) => creditLine(c) },
  { key: "contract", header: "Contract here", cell: (c) => c.contractName
    ? <span>{c.contractName} <span className="text-grey-500">to {dateShort(c.contractTo)}</span></span>
    : <span className="text-grey-500">-</span> },
];

/* The list in a file (D27-383 item 1). Credit not set is a dash. */
const CONTRACT_EXPORT: ExportColumn<CompanyRow>[] = [
  { label: "Company", value: (c) => c.name },
  { label: "Kind", value: (c) => KIND_LABEL[c.kind] ?? c.kind },
  { label: "GSTIN", value: (c) => c.gstin },
  { label: "Contact", value: (c) => c.contactName },
  { label: "Phone", value: (c) => c.phone },
  { label: "Email", value: (c) => c.email },
  { label: "City", value: (c) => c.city },
  { label: "State", value: (c) => c.state },
  { label: "Credit", value: (c) => (c.creditAllowed ? "Yes" : "No") },
  { label: "Credit days", value: (c) => c.creditDays, kind: "count" },
  { label: "Credit limit", value: (c) => c.creditLimit, kind: "money" },
  { label: "Contract here", value: (c) => c.contractName },
  { label: "Contract until", value: (c) => c.contractTo, kind: "date" },
];

export default function ContractsPage() {
  const hotelId = useUi((s) => s.hotelId);
  const role = useRole();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["company-records", hotelId],
    queryFn: () => listCompanyRecords(hotelId),
    enabled: !!hotelId,
  });

  return (
    <Page>
      <PageHeader
        title="Contracts"
        description="Companies and agents, and the rates each has agreed with this hotel."
        actions={<>
          <ExportButtons screen="contracts" rows={data} columns={CONTRACT_EXPORT} />
          {can(role, "create", "company") && (
            <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAdding(true)}>
              Add company
            </Button>
          )}
        </>}
      />
      <Card>
        <DataTable<CompanyRow>
          rows={data ?? []}
          columns={COLUMNS}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          onRowClick={(c) => navigate(`/contracts/${c.id}`)}
          empty={
            <EmptyState compact icon={<Building2 />} title="No companies yet"
              description="A company or travel agent added here can be named on a booking, billed, and given a contract." />
          }
        />
      </Card>
      <CompanyDialog hotelId={hotelId} open={adding} onOpenChange={setAdding}
        onSaved={(id) => navigate(`/contracts/${id}`)} />
    </Page>
  );
}
