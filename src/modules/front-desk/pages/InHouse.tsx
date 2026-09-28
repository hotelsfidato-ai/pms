import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, useNavigate } from "react-router";
import { dateLong, money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Segmented, StatusPill } from "@/components/ui";
import { StayTable, type StayColumn, type StayRow } from "@/modules/front-desk/components/StayTable";
import { listInHouse, listDepartures, getHouseNow } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";
import { getFolioBalance } from "@/modules/finance";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";

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
  const navigate = useNavigate();

  /* No bill reads for a role without bills (D27-143): each one was a 403.
     The balance column prints its dash. */
  const bills = can(useRole(), "view", "invoice");
  const inHouse = useQuery({
    queryKey: queryKeys.inHouse(hotelId, BUSINESS_DATE),
    queryFn: async () => {
      const stays: StayRow[] = await listInHouse(hotelId, BUSINESS_DATE);
      return bills ? withBalances(hotelId, stays) : stays;
    },
  });

  const departures = useQuery({
    queryKey: queryKeys.departures(hotelId, BUSINESS_DATE),
    queryFn: async () => {
      const stays: StayRow[] = await listDepartures(hotelId, BUSINESS_DATE);
      return bills ? withBalances(hotelId, stays) : stays;
    },
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
            <StatusPill tone={dueOut ? "warning" : "info"}>
              {rooms} room{rooms === 1 ? "" : "s"}
            </StatusPill>
          ) : undefined
        }
        actions={
          <Segmented<"now" | "due-out">
            value={dueOut ? "due-out" : "now"}
            onChange={(v) => navigate(v === "due-out" ? `/h/${hotelId}/in-house/due-out` : `/h/${hotelId}/in-house`)}
            className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
            options={[
              { value: "now", label: <>Current stays<Count n={inHouse.data?.length} /></> },
              { value: "due-out", label: <>Due out<Count n={departures.data?.length} /></> },
            ]}
          />
        }
      />

      {dueOut && outstanding.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-red-100 bg-brand-red-50 px-4 py-3.5 mb-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">
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
    </Page>
  );
}

/** A count beside a switch's words, quiet. */
function Count({ n }: { n: number | undefined }) {
  return n === undefined ? null : <span className="ml-1.5 text-xs text-grey-500 tabular">{n}</span>;
}
