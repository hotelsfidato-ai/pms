import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, StatusPill } from "@/components/ui";
import { StayTable, type StayColumn } from "@/modules/front-desk/components/StayTable";
import { listStays } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   WALK-INS

   A record, not a form. Taking a walk-in starts from an empty cell in
   Stay view, because the first question is always "which room is
   free tonight" and the chart answers it in one glance. A separate
   New Walk-in form would ask the clerk to already know.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: StayColumn[] = [
  "room", "guest", "type", "plan", "arrival", "departure", "nights", "status", "rate",
];

export default function WalkInsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.stays(hotelId, "walk-ins"),
    queryFn: async () => {
      const all = await listStays(hotelId, { source: ["Walk-in"] });
      return all.sort((a, b) => b.arrival.localeCompare(a.arrival));
    },
  });

  const today = (data ?? []).filter((s) => s.arrival === BUSINESS_DATE).length;

  return (
    <Page>
      <PageHeader
        title="Walk-ins"
        description={`Guests taken at the desk without a booking. ${today} today, ${dateLong(BUSINESS_DATE)}.`}
        badge={data ? <StatusPill tone="neutral">{data.length} on record</StatusPill> : undefined}
      />

      <div className="flex items-start gap-3 rounded-md border border-grey-200 bg-grey-50 p-3.5 mb-5">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-ink-900">Take a walk-in from Stay view</p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Click any empty cell on the chart. The room and the night are already
            chosen by the time the form opens, which is the order the question
            actually arrives in at a front desk.
          </p>
        </div>
        <Link
          to={`/h/${hotelId}/stay`}
          className="inline-flex items-center gap-1.5 text-sm text-brand-orange-700 hover:underline shrink-0 mt-0.5
            pointer-coarse:min-h-11"
        >
          Open Stay view
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <Card className="p-4">
        <StayTable
          hotelId={hotelId}
          businessDate={BUSINESS_DATE}
          rows={data}
          isLoading={isLoading}
          error={error}
          onRetry={() => refetch()}
          columns={COLUMNS}
          offerCheckIn
          emptyTitle="No walk-ins on record"
          emptyBody="One appears here the moment it is taken from an empty cell in Stay view."
        />
      </Card>
    </Page>
  );
}
