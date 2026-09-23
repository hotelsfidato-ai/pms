import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "react-router";
import { cn } from "@/lib/cn";
import { dateLong, money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, StatusPill } from "@/components/ui";
import { StayTable, type StayColumn, type StayRow } from "@/modules/front-desk/components/StayTable";
import { listInHouse, listDepartures, getHouseNow } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";
import { getFolioBalance } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   IN HOUSE · DUE OUT

   Every guest checked in now (the owner's D17-10), and those of them
   leaving today. Both carry a
   folio balance, because on the departure list that number is the one
   thing standing between a guest and the door — check-out stays
   disabled until it reaches zero.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: StayColumn[] = [
  "room", "guest", "type", "plan", "arrival", "departure", "status", "balance",
];

/** Attaches each stay's live folio balance. */
async function withBalances(hotelId: string, stays: StayRow[]): Promise<StayRow[]> {
  return Promise.all(
    /* No bill is no figure (D17-16): undefined prints the table's mark, never ₹0. */
    stays.map(async (s) => ({ ...s, balance: (await getFolioBalance(hotelId, s.id)) ?? undefined })),
  );
}

export default function InHousePage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const { pathname } = useLocation();
  const dueOut = pathname.endsWith("/due-out");

  const inHouse = useQuery({
    queryKey: queryKeys.inHouse(hotelId, BUSINESS_DATE),
    queryFn: async () =>
      withBalances(hotelId, await listInHouse(hotelId, BUSINESS_DATE)),
  });

  const departures = useQuery({
    queryKey: queryKeys.departures(hotelId, BUSINESS_DATE),
    queryFn: async () =>
      withBalances(hotelId, await listDepartures(hotelId, BUSINESS_DATE)),
  });

  /* HOW MANY ROOMS are in house is the server's one count (D21-36), the
     number the Dashboard's In house tile shows. The list can hold more
     bookings than rooms: a guest due out and not yet checked out, and the
     guest arriving into the same room, are two rows in one room. */
  const house = useQuery({
    queryKey: ["house-now", hotelId],
    queryFn: () => getHouseNow(hotelId),
    enabled: !dueOut,
  });

  const active = dueOut ? departures : inHouse;
  const rooms = dueOut ? departures.data?.length : house.data?.inHouse;

  /* What a clerk needs to know before the queue forms at 11am. */
  const outstanding = (departures.data ?? []).filter((s) => (s.balance ?? 0) > 0);
  const owed = outstanding.reduce((t, s) => t + (s.balance ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title={dueOut ? "Due out" : "In house"}
        description={
          dueOut
            ? `Departing ${dateLong(BUSINESS_DATE)}. Check-out unlocks when the bill reaches zero.`
            : `Guests checked in now, on ${dateLong(BUSINESS_DATE)}.`
        }
        badge={
          rooms !== undefined ? (
            <StatusPill tone={dueOut ? "warning" : "success"}>
              {rooms} room{rooms === 1 ? "" : "s"}
            </StatusPill>
          ) : undefined
        }
      />

      <nav className="flex items-center gap-1 border-b border-grey-200 -mb-px mb-5">
        <Tab to={`/h/${hotelId}/in-house`} active={!dueOut} count={inHouse.data?.length}>
          Current stays
        </Tab>
        <Tab to={`/h/${hotelId}/in-house/due-out`} active={dueOut} count={departures.data?.length}>
          Due out
        </Tab>
      </nav>

      {dueOut && outstanding.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-brand-red-100 bg-brand-red-50 p-3.5 mb-4">
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900">
              {outstanding.length} departure{outstanding.length === 1 ? "" : "s"} still owing{" "}
              <span className="tabular">{money(owed)}</span>
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              Settle from the Bill tab. Check-out stays disabled with its reason until each
              balance clears.
            </p>
          </div>
        </div>
      )}

      <Card className="p-4">
        <StayTable
          hotelId={hotelId}
          businessDate={BUSINESS_DATE}
          rows={active.data}
          isLoading={active.isLoading}
          error={active.error}
          onRetry={() => active.refetch()}
          columns={COLUMNS}
          defaultTab={dueOut ? "folio" : "stay"}
          emptyTitle={dueOut ? "Nobody departing today" : "Nobody in house"}
          emptyBody={
            dueOut
              ? "Every room stays another night."
              : "The house is empty tonight."
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
