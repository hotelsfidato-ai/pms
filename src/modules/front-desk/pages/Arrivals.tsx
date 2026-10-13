import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, useNavigate } from "react-router";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Segmented, StatusPill } from "@/components/ui";
import { StayTable, type StayColumn } from "@/modules/front-desk/components/StayTable";
import { fetchStays, listArrivals } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE } from "@/data/repositories";
import { addDays } from "@/modules/front-desk/data/stayview";
import { BookingSiteBlacklist } from "@/modules/guests";

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
  const navigate = useNavigate();

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
      /* Only who arrives in the fortnight (and who is checked in), not
         every booking ever made (D27-313). */
      const all = await fetchStays(hotelId, from, to);
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
        /* Today or the fortnight ahead: a switch in the title row, the
           same words and counts the tabs had (the owner, 27 September). */
        actions={
          <Segmented<"today" | "upcoming">
            value={upcoming ? "upcoming" : "today"}
            onChange={(v) => navigate(v === "upcoming" ? `/h/${hotelId}/arrivals/upcoming` : `/h/${hotelId}/arrivals`)}
            className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
            options={[
              { value: "today", label: <>Today<Count n={today.data?.length} /></> },
              /* The menu's word (D27-271): one name for one screen. */
              { value: "upcoming", label: <>Upcoming<Count n={ahead.data?.length} /></> },
            ]}
          />
        }
      />

      {/* CRM-3 (D22-8): a booking site's guest on a blacklisted phone or email. */}
      <div className="mb-5 empty:hidden">
        <BookingSiteBlacklist hotelId={hotelId}
          from={upcoming ? addDays(BUSINESS_DATE, 1) : BUSINESS_DATE}
          to={upcoming ? addDays(BUSINESS_DATE, 14) : BUSINESS_DATE}
          stayIds={active.data?.map((s) => s.id)} />
      </div>

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
            : "Nobody is expected. A walk-in can be taken from any empty cell on the Calendar."
        }
      />
    </Page>
  );
}

/** A count beside a switch's words, quiet. */
function Count({ n }: { n: number | undefined }) {
  return n === undefined ? null : <span className="ml-1.5 text-xs text-grey-500 tabular">{n}</span>;
}
