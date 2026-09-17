import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "react-router";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, StatusPill } from "@/components/ui";
import { StayTable, type StayColumn } from "@/modules/front-desk/components/StayTable";
import { listArrivals, listStays } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";
import { addDays } from "@/modules/front-desk/data/stayview";

/* ══════════════════════════════════════════════════════════════════
   ARRIVALS

   Two views of the same question — who is coming. Today is the one a
   clerk works from; upcoming is the one they plan with. Both are the
   same table with a different range, and check-in is offered from the
   row rather than from a separate screen.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: StayColumn[] = [
  "room", "guest", "type", "plan", "source", "departure", "nights", "status", "rate",
];

export default function ArrivalsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const { pathname } = useLocation();
  const upcoming = pathname.endsWith("/upcoming");

  const today = useQuery({
    queryKey: queryKeys.arrivals(hotelId, BUSINESS_DATE),
    queryFn: () => listArrivals(hotelId, BUSINESS_DATE),
  });

  /* The next fortnight, excluding today — planning, not working. */
  const ahead = useQuery({
    queryKey: queryKeys.stays(hotelId, { upcoming: true }),
    queryFn: async () => {
      const from = addDays(BUSINESS_DATE, 1);
      const to = addDays(BUSINESS_DATE, 14);
      const all = await listStays(hotelId, { from, to });
      return all.filter(
        (s) => s.arrival > BUSINESS_DATE && s.arrival <= to && s.status !== "cancelled",
      );
    },
    enabled: upcoming,
  });

  const active = upcoming ? ahead : today;

  return (
    <Page>
      <PageHeader
        title="Arrivals"
        description={
          upcoming
            ? `Expected between ${dateLong(addDays(BUSINESS_DATE, 1))} and ${dateLong(addDays(BUSINESS_DATE, 14))}.`
            : `Expected on ${dateLong(BUSINESS_DATE)}. Check in from the row - the panel opens over this list.`
        }
        badge={
          active.data ? (
            <StatusPill tone={active.data.length ? "info" : "neutral"}>
              {active.data.length} expected
            </StatusPill>
          ) : undefined
        }
      />

      <nav className="flex items-center gap-1 border-b border-grey-200 -mb-px mb-5">
        <Tab to={`/h/${hotelId}/arrivals`} active={!upcoming} count={today.data?.length}>
          Today
        </Tab>
        <Tab to={`/h/${hotelId}/arrivals/upcoming`} active={upcoming} count={ahead.data?.length}>
          Next fourteen days
        </Tab>
      </nav>

      <Card className="p-4">
        <StayTable
          hotelId={hotelId}
          businessDate={BUSINESS_DATE}
          rows={active.data}
          isLoading={active.isLoading}
          error={active.error}
          onRetry={() => active.refetch()}
          columns={COLUMNS}
          offerCheckIn={!upcoming}
          emptyTitle={upcoming ? "Nothing booked in the next fortnight" : "No arrivals today"}
          emptyBody={
            upcoming
              ? "Bookings appear here as they are taken."
              : "Nobody is expected. A walk-in can be taken from any empty cell in Stay view."
          }
        />
      </Card>
    </Page>
  );
}

function Tab({
  to, active, count, children,
}: {
  to: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "relative px-3 py-2.5 text-base font-medium whitespace-nowrap",
        "pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center",
        "border-b-2 -mb-px transition-colors duration-150",
        active
          ? "text-ink-900 border-brand-orange"
          : "text-grey-500 border-transparent hover:text-ink-900",
      )}
    >
      {children}
      {count !== undefined && (
        <span className="ml-1.5 text-2xs text-grey-500 tabular">{count}</span>
      )}
    </Link>
  );
}
