import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { NO_DATE, money } from "@/lib/format";
import {
  Page, PageHeader, Card, CardHeader, DataTable, EmptyState, Input, readError, type Column,
} from "@/components/ui";
import { getNumbers, type CampaignLine, type SourceLine } from "@/modules/marketing/data/numbers";

/* ══════════════════════════════════════════════════════════════════
   MARKETING (D27-168, D27-170)

   Which campaign brought which stay, what it cost and what it earned, for
   one month by arrival date. Spend comes from the leads app, read as the
   page opens; bookings and revenue come from this system's own stays, so
   revenue per campaign is what real stays were charged (room charges
   before tax, cancelled and no-shows out), never a figure typed in the
   leads app. The owner, an administrator and the GM only (D27-170).
   ══════════════════════════════════════════════════════════════════ */

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const rupees = (v: string | number | null) => (v === null ? NO_DATE : money(Number(v)));
const PLATFORM: Record<string, string> = { meta: "Meta Ads", google: "Google Ads", other: "Other ads" };

const CAMPAIGN_COLUMNS: Column<CampaignLine>[] = [
  { key: "name", header: "Campaign", cell: (r) => r.name ?? r.key },
  { key: "platform", header: "Where", cell: (r) => (r.platform ? PLATFORM[r.platform] ?? r.platform : NO_DATE) },
  { key: "spend", header: "Spend", numeric: true, cell: (r) => rupees(r.spend) },
  { key: "bookings", header: "Bookings", numeric: true, cell: (r) => r.bookings },
  { key: "revenue", header: "Revenue", numeric: true, cell: (r) => rupees(r.revenue) },
];

const SOURCE_COLUMNS: Column<SourceLine>[] = [
  { key: "name", header: "Booking source", cell: (r) => r.name ?? "No source recorded" },
  { key: "bookings", header: "Bookings", numeric: true, cell: (r) => r.bookings },
  { key: "revenue", header: "Revenue", numeric: true, cell: (r) => rupees(r.revenue) },
];

export default function MarketingPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [month, setMonth] = useState(thisMonth);

  const q = useQuery({
    queryKey: ["marketing-numbers", code, month],
    queryFn: () => getNumbers(code, month),
    enabled: !!code && /^\d{4}-\d{2}$/.test(month),
    /* The spend is a read of the leads app: never on focus. */
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const failure = readError(q);
  const d = q.data;

  /* Why spend may show dashes, in one line under the campaigns. */
  const spendNote = !d ? null
    : !d.connected ? "Spend is read from the leads app, which is not connected yet."
    : !d.inApp ? "This property is not one of the leads app's hotels, so it has no spend."
    : d.appError;

  return (
    <Page>
      <PageHeader
        title="Marketing"
        description="One month, by arrival date. Spend from the leads app; bookings and revenue from this system's own stays, room charges before tax."
        actions={
          <label className="flex items-center gap-2 text-sm text-grey-600">
            Month
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          </label>
        }
      />

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader title="Campaigns" description="A booking carries its campaign when it is made from a lead." />
          <DataTable
            columns={CAMPAIGN_COLUMNS}
            rows={d?.campaigns ?? []}
            rowKey={(r) => r.key}
            loading={q.isPending}
            error={failure}
            onRetry={() => void q.refetch()}
            empty={<EmptyState compact title="No campaigns this month" description="No spend was recorded in the leads app, and no stay arriving this month came from a campaign." />}
          />
          {spendNote && <p className="px-4 py-3 text-sm text-grey-600 border-t border-grey-100">{spendNote}</p>}
        </Card>

        <Card>
          <CardHeader title="By booking source" description="Every stay arriving this month." />
          <DataTable
            columns={SOURCE_COLUMNS}
            rows={d?.sources ?? []}
            rowKey={(r) => r.id ?? "none"}
            loading={q.isPending}
            error={failure}
            onRetry={() => void q.refetch()}
            empty={<EmptyState compact title="No stays arrive this month" />}
          />
        </Card>
      </div>
    </Page>
  );
}
