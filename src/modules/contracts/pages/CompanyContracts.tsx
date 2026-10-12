import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus } from "lucide-react";
import { moneyPrecise, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardHeader, CardBody, DetailList, DetailRow, Button, StatusPill,
  EmptyState, ErrorState, Skeleton,
} from "@/components/ui";
import {
  getCompanyContracts, KIND_LABEL, type CompanyContracts, type Contract,
} from "@/modules/contracts/data/contracts";
import { CompanyDialog } from "@/modules/contracts/components/CompanyDialog";
import { ContractDialog } from "@/modules/contracts/components/ContractDialog";
import { creditLine } from "@/modules/contracts/pages/Contracts";

/* ══════════════════════════════════════════════════════════════════
   ONE COMPANY: its record and its contracts at this hotel (D27-184).
   Edit company, Add contract and Edit are the owner's, an administrator's
   and the GM's (C-6); everybody who reads companies reads this.
   ══════════════════════════════════════════════════════════════════ */

const address = (c: CompanyContracts["company"]) =>
  [c.addressLine, c.city, c.state, c.pincode].filter(Boolean).join(", ") || "-";

export default function CompanyContractsPage() {
  const hotelId = useUi((s) => s.hotelId);
  const { companyId = "" } = useParams();
  const keeper = can(useRole(), "edit", "company");
  const [editing, setEditing] = useState(false);
  const [contract, setContract] = useState<Contract | "new" | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["company-contracts", hotelId, companyId],
    queryFn: () => getCompanyContracts(hotelId, companyId),
    enabled: !!hotelId && !!companyId,
  });

  if (isLoading) return <Page><Skeleton className="h-40" /></Page>;
  if (error || !data) {
    return <Page><ErrorState title="This company could not be read." onRetry={() => void refetch()} /></Page>;
  }
  const c = data.company;

  return (
    <Page>
      <PageHeader
        title={c.name}
        breadcrumbs={[{ label: "Contracts", to: "/contracts" }, { label: c.name }]}
        badge={<StatusPill tone="neutral">{KIND_LABEL[c.kind]}</StatusPill>}
        actions={keeper && (
          <Button variant="primary" leadingIcon={<Plus />} onClick={() => setContract("new")}>
            Add contract
          </Button>
        )}
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
        <Card>
          <CardHeader title="Company"
            actions={keeper && <Button size="sm" onClick={() => setEditing(true)}>Edit company</Button>} />
          <CardBody className="py-1">
            <DetailList>
              <DetailRow label="GSTIN"><span className="tabular">{c.gstin ?? "-"}</span></DetailRow>
              <DetailRow label="Billing address">{address(c)}</DetailRow>
              <DetailRow label="Contact">
                {[c.contactName, c.phone, c.email].filter(Boolean).join(" · ") || "-"}
              </DetailRow>
              <DetailRow label="Credit">{creditLine(c)}</DetailRow>
            </DetailList>
          </CardBody>
        </Card>

        <div className="space-y-3">
          {data.contracts.length === 0 ? (
            <Card>
              <EmptyState compact title="No contract at this hotel"
                description="Bookings for this company take the price on Rates until a contract is added." />
            </Card>
          ) : data.contracts.map((k) => (
            <ContractCard key={k.id} k={k} data={data} keeper={keeper} onEdit={() => setContract(k)} />
          ))}
        </div>
      </div>

      <CompanyDialog hotelId={hotelId} company={c} open={editing} onOpenChange={setEditing} />
      <ContractDialog hotelId={hotelId} data={data}
        contract={contract === "new" || contract === null ? undefined : contract}
        open={contract !== null} onOpenChange={(o) => { if (!o) setContract(null); }} />
    </Page>
  );
}

function ContractCard({ k, data, keeper, onEdit }: {
  k: Contract; data: CompanyContracts; keeper: boolean; onEdit: () => void;
}) {
  const inForce = data.today >= k.validFrom && data.today <= k.validTo;
  const typeName = (id: string) => data.roomTypes.find((t) => t.id === id)?.name ?? "-";
  const price = (n: number | null) => (n === null ? "-" : moneyPrecise(n));
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">{k.name}
          {inForce && <StatusPill tone="success">In force</StatusPill>}</span>}
        description={`${dateShort(k.validFrom)} to ${dateShort(k.validTo)}`}
        actions={keeper && <Button size="sm" onClick={onEdit}>Edit</Button>} />
      <CardBody className="space-y-2 text-sm">
        {k.pricing === "discount" ? (
          <p>{k.discountPercent}% off the day's rate</p>
        ) : (
          <table className="w-full tabular">
            <thead>
              <tr className="text-xs text-grey-500 text-left">
                <th className="font-medium py-1">Room</th><th className="font-medium">Plan</th>
                <th className="font-medium text-right">Single</th><th className="font-medium text-right">Double</th>
              </tr>
            </thead>
            <tbody>
              {k.rates.map((r) => (
                <tr key={`${r.roomTypeId}|${r.mealPlan}`} className="border-t border-grey-100">
                  <td className="py-1.5">{typeName(r.roomTypeId)}</td><td>{r.mealPlan}</td>
                  <td className="text-right">{price(r.single)}</td><td className="text-right">{price(r.double)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.company.kind === "travel_agent" && (
          <p className="text-grey-600">Commission {k.commissionPct === null ? "-" : `${k.commissionPct}%`}</p>
        )}
        {k.notes && <p className="text-grey-600">{k.notes}</p>}
      </CardBody>
    </Card>
  );
}

