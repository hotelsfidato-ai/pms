import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { dateShort } from "@/lib/format";
import { Page, PageHeader, Card, CardHeader, Button, Input, Skeleton, toast } from "@/components/ui";
import { getCommission, setSourceCommission } from "@/modules/finance/data/money";

/* ══════════════════════════════════════════════════════════════════
   COMMISSION (the owner's D27-259 Q5): what each booking source takes at
   this hotel, set here, and what each agent contract carries, set on the
   contract. Stamped on each booking as it is made, so a change here never
   restates a past month (082). A dash is "not agreed" - never 0%.
   No payouts yet.
   ══════════════════════════════════════════════════════════════════ */

export default function CommissionPage() {
  const hotelId = useUi((s) => s.hotelId);
  const view = useQuery({ queryKey: ["commission", hotelId], queryFn: () => getCommission(hotelId) });
  const data = view.data;

  return (
    <Page>
      <PageHeader title="Commission"
        description="What each booking source and agent takes. A change applies to bookings made after it." />
      {!data ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Booking sources" description="Blank: no commission agreed (a dash, not 0%)." />
            <ul className="divide-y divide-grey-200">
              {data.sources.map((s) => <SourceRow key={s.id} hotelId={hotelId} source={s} />)}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Agent contracts" description="Set on the company's contract." />
            {data.contracts.length === 0 ? (
              <p className="px-4 pb-4 text-grey-500">No contract carries a commission.</p>
            ) : (
              <ul className="divide-y divide-grey-200">
                {data.contracts.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to={`/companies/${k.companyId}`} className="text-base font-medium hover:underline">
                        {k.company}
                      </Link>
                      <p className="truncate text-sm text-grey-500">
                        {k.name} · from {dateShort(k.validFrom)}{k.validTo ? ` to ${dateShort(k.validTo)}` : ""}
                      </p>
                    </div>
                    <span className="tabular text-base">{k.commissionPct}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}

function SourceRow({ hotelId, source }: {
  hotelId: string; source: { id: string; name: string; commissionPct: number | null };
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(source.commissionPct === null ? "" : String(source.commissionPct));
  const typed = value.trim() === "" ? null : Number(value);
  const changed = typed !== source.commissionPct;

  const save = async () => {
    const res = await setSourceCommission(hotelId, source.id, typed);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`${source.name}: ${typed === null ? "no commission" : `${typed}%`}`);
    await qc.invalidateQueries({ queryKey: ["commission", hotelId] });
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-base">{source.name}</span>
      <Input aria-label={`${source.name} commission %`} className="w-24 text-right" type="number"
             min={0} max={100} inputMode="decimal" placeholder="-" value={value}
             onChange={(e) => setValue(e.target.value)} />
      <span className="text-grey-500">%</span>
      <Button variant="secondary" className="h-10" disabled={!changed} onClick={() => void save()}>Save</Button>
    </li>
  );
}
