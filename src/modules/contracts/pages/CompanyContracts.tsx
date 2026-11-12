import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { addDays, moneyPrecise, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardHeader, CardBody, DetailList, DetailRow, Button, StatusPill,
  EmptyState, ErrorState, Skeleton,
} from "@/components/ui";
import {
  getCompanyContracts, KIND_LABEL, leftIn, nightsAhead,
  type Allotment, type CompanyContracts, type Contract,
} from "@/modules/contracts/data/contracts";
import { CompanyDialog } from "@/modules/contracts/components/CompanyDialog";
import { ContractDialog } from "@/modules/contracts/components/ContractDialog";
import { AllotmentDialog } from "@/modules/contracts/components/AllotmentDialog";
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
  const role = useRole();
  const keeper = can(role, "edit", "company");
  /* Booking from an allotment is a booking: whoever may make one (267). */
  const mayBook = can(role, "create", "reservation");
  const [editing, setEditing] = useState(false);
  const [contract, setContract] = useState<Contract | "new" | null>(null);
  const [holding, setHolding] = useState<{ k: Contract; a?: Allotment } | null>(null);
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
            <ContractCard key={k.id} k={k} data={data} keeper={keeper} onEdit={() => setContract(k)}>
              <Allotments k={k} data={data} keeper={keeper} mayBook={mayBook} hotelId={hotelId}
                onHold={(a) => setHolding({ k, a })} />
            </ContractCard>
          ))}
        </div>
      </div>

      <CompanyDialog hotelId={hotelId} company={c} open={editing} onOpenChange={setEditing} />
      <ContractDialog hotelId={hotelId} data={data}
        contract={contract === "new" || contract === null ? undefined : contract}
        open={contract !== null} onOpenChange={(o) => { if (!o) setContract(null); }} />
      {holding && (
        <AllotmentDialog hotelId={hotelId} data={data} contract={holding.k}
          {...(holding.a ? { allotment: holding.a } : {})}
          open onOpenChange={(o) => { if (!o) setHolding(null); }} />
      )}
    </Page>
  );
}

function ContractCard({ k, data, keeper, onEdit, children }: {
  k: Contract; data: CompanyContracts; keeper: boolean; onEdit: () => void; children?: ReactNode;
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
      {children}
    </Card>
  );
}

/* ── The rooms held under one contract (D27-383 item 8, 267) ─────────
   Each allotment: its nights, rooms and release; what has been booked from
   it, what it still holds and what has gone back on sale; the contract's
   rate for its room type, a dash where none is agreed. */
function Allotments({ k, data, keeper, mayBook, hotelId, onHold }: {
  k: Contract; data: CompanyContracts; keeper: boolean; mayBook: boolean; hotelId: string;
  onHold: (a?: Allotment) => void;
}) {
  const navigate = useNavigate();
  const mine = data.allotments.filter((a) => a.contractId === k.id);
  const inForce = data.today <= k.validTo;
  if (mine.length === 0 && !(keeper && inForce)) return null;
  const price = (n: number | null) => (n === null ? "-" : moneyPrecise(n));
  const rate = (a: Allotment) => k.pricing === "discount"
    ? `${k.discountPercent}% off the day's rate`
    : a.rates.length === 0 ? "-"
      : a.rates.map((r) => `${r.mealPlan} ${price(r.single)} / ${price(r.double)}`).join(" · ");
  return (
    <CardBody className="border-t border-grey-100 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-ink-900">Allotments</h3>
        {keeper && inForce && (
          <Button size="sm" className="ml-auto" onClick={() => onHold()}>Hold rooms</Button>
        )}
      </div>
      {mine.length === 0 && <p className="text-grey-600">No rooms held under this contract.</p>}
      <ul className="divide-y divide-grey-100">
        {mine.map((a) => {
          const left = leftIn(a, data.today);
          const booked = Math.max(0, ...a.nights.map((n) => n.picked));
          const released = a.nights.filter((n) => n.released);
          const back = released.reduce((s, n) => s + (n.releasedRooms ?? 0), 0);
          const next = nightsAhead(a, data.today)[0];
          return (
            <li key={a.id} className="py-3 first:pt-0 space-y-1" data-allotment={a.id}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-ink-900">
                  {a.roomType} · {a.rooms} {a.rooms === 1 ? "room" : "rooms"} a night
                </span>
                <span className="text-grey-600 tabular">
                  {dateShort(a.firstNight)} to {dateShort(a.lastNight)}
                </span>
              </div>
              <p className="text-grey-600">
                Released {a.releaseDays} {a.releaseDays === 1 ? "day" : "days"} before each night
                {next ? ` · next on ${dateShort(addDays(next.night, -a.releaseDays))}` : ""}
              </p>
              <p className="text-grey-700 tabular">
                Booked from it {booked} · Still held {left === null ? "-" : left}
                {left !== null && " (the fewest on a night)"} · Back on sale {back}
                {released.length > 0 && ` over ${released.length} ${released.length === 1 ? "night" : "nights"}`}
              </p>
              <p className="text-grey-600">Rate: <span className="tabular">{rate(a)}</span></p>
              {a.notes && <p className="text-grey-600">{a.notes}</p>}
              {(keeper || (mayBook && left !== null && left > 0)) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mayBook && left !== null && left > 0 && (
                    <Button size="sm" onClick={() => navigate(`/h/${hotelId}/book?allotment=${a.id}`)}>
                      Book from it
                    </Button>
                  )}
                  {keeper && <Button size="sm" onClick={() => onHold(a)}>Change</Button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </CardBody>
  );
}


