import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Lightbulb, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort, percent } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, DataTable, EmptyState, ErrorState,
  IconChip, Skeleton, StatusPill, type Column,
} from "@/components/ui";
import { getOutlook, getPace, getPickup } from "@/modules/revenue-management/data/outlook";
import {
  aheadBy, softestFirst, suggest, temperOf, type DateAhead,
} from "@/modules/revenue-management/logic/outlook";
import {
  onTheBooksAWeekAgo, pickupOn, whyNoPickup,
} from "@/modules/revenue-management/logic/pickup";

/* ══════════════════════════════════════════════════════════════════
   THE COMING NIGHTS

   D18-15, the owner's own words: this screen SHOWS and SUGGESTS, and it
   never changes a price by itself. There is no control on it that
   writes anything, and there is no code in this folder that could -
   `neverWritesARate.test.ts` reads both of this service's folders and
   refuses an insert, an update, a write over HTTP or a word to the
   channel manager. The change is made on the Rate calendar, by the GM
   or the owner, exactly as today.

   EVERY FIGURE IS THE REPORTS SERVICE'S. Available, sold and occupancy
   come through `@/modules/reports` - the same derivation the Manager
   report and the Dashboard add up. Nothing is worked out twice here.
   PICKUP and the week-ago column of pace (RM-1, 19 September) are this
   service's own route, but they count over the reports service's
   `stay_nights` fragment, imported through its door - so the rooms
   this screen calls sold are the rooms the Manager report calls sold,
   by construction.

   WHO SEES IT: the four roles who may move a rate - the owner, an
   administrator, the GM and the Revenue Manager (`setsRates`). It is
   read-only, but it is the rate conversation, and the people in that
   conversation are the ones `permissions.ts` already names.

   NO FIGURE IS INVENTED. A month the property could not have traded in
   has no comparison - a sentence, never a zero (D17-93).
   ══════════════════════════════════════════════════════════════════ */

const TONE = { soft: "warning", strong: "success", steady: "neutral" } as const;
const WORD = { soft: "Soft", strong: "Filling well", steady: "On track" } as const;

/** A figure nobody can set is a dash, never a zero. */
const orDash = (value: number | null, show: (n: number) => string) =>
  value === null ? "-" : show(value);

export default function OutlookPage() {
  const params = useParams();
  const code = (params["code"] ?? "").toUpperCase();

  const outlook = useQuery({
    queryKey: ["revenue-outlook", code],
    queryFn: () => getOutlook(code),
  });

  const today = outlook.data?.today ?? "";
  const pace = useQuery({
    queryKey: ["revenue-pace", code, today],
    queryFn: () => getPace(code, today),
    enabled: Boolean(today),
  });

  /* PICKUP (RM-1). Its own query, so a property whose pickup cannot be
     read still gets its outlook: the dashes and their sentence are a
     smaller failure than a blank screen, and they say which one it is. */
  const pickup = useQuery({
    queryKey: ["revenue-pickup", code, today],
    queryFn: () => getPickup(code, today),
    enabled: Boolean(today),
  });
  const picked = pickup.data ?? null;
  const noPickup = pickup.isLoading ? null : whyNoPickup(picked);

  const days = outlook.data?.days ?? [];
  const soft = softestFirst(days);
  const suggestions = days.map(suggest).filter((s) => s !== null);

  const columns: Column<DateAhead>[] = [
    { key: "date", header: "Date", width: "w-[150px]",
      cell: (d) => dateShort(d.date) },
    { key: "out", header: "Days out", numeric: true, hideBelow: "sm",
      cell: (d) => (d.daysOut === 0 ? "Tonight" : String(d.daysOut)) },
    { key: "left", header: "Rooms left", numeric: true,
      cell: (d) => String(d.left) },
    { key: "available", header: "Of", numeric: true, hideBelow: "md",
      cell: (d) => String(d.available) },
    { key: "occupancy", header: "Sold", numeric: true,
      cell: (d) => percent(d.occupancyPct) },
    /* Of the rooms sold for that night, how many were booked in the
       last 1, 7 and 30 days. Hidden below the breakpoints named, NOT
       dropped: a narrow screen shows each one as a labelled line in
       the row's card, which is why the headers read as sentences
       rather than as "1d" (DataTable, and 375px). */
    { key: "last1", header: "New 1 day", numeric: true, hideBelow: "lg",
      cell: (d) => orDash(pickupOn(picked, d.date).last1, String) },
    { key: "last7", header: "New 7 days", numeric: true, hideBelow: "sm",
      cell: (d) => orDash(pickupOn(picked, d.date).last7, String) },
    { key: "last30", header: "New 30 days", numeric: true, hideBelow: "lg",
      cell: (d) => orDash(pickupOn(picked, d.date).last30, String) },
    { key: "temper", header: "", width: "w-[130px]",
      cell: (d) => {
        const t = temperOf(d);
        return <StatusPill tone={TONE[t]}>{WORD[t]}</StatusPill>;
      } },
  ];

  if (outlook.isError) {
    return (
      <Page className="max-w-5xl">
        <PageHeader title="Revenue outlook" />
        <ErrorState error={outlook.error} onRetry={() => void outlook.refetch()} />
      </Page>
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Revenue outlook"
        description={
          "What the coming ninety nights look like, and what they suggest. "
          + "Nothing here changes a price - the Rate calendar does that."
        }
      />

      {/* Pace - this month, against the same month last year. */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="text-md font-semibold text-ink-900 flex items-center gap-2.5">
            <IconChip><TrendingUp /></IconChip>
            This month, on the books
          </h2>

          {pace.isLoading || outlook.isLoading ? (
            <Skeleton className="h-16 mt-3" />
          ) : !pace.data ? (
            <p className="text-sm text-grey-600 mt-3">
              No figures for this property yet.
            </p>
          ) : (
            <Pace
              now={pace.data.now}
              ahead={aheadBy(pace.data)}
              weekAgo={onTheBooksAWeekAgo(pace.data.now, picked)}
            />
          )}
        </CardBody>
      </Card>

      {/* What it would suggest: a sentence, and its reason. */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="text-md font-semibold text-ink-900 flex items-center gap-2.5">
            <IconChip><Lightbulb /></IconChip>
            What to consider
          </h2>

          {outlook.isLoading ? (
            <Skeleton className="h-16 mt-3" />
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-grey-600 mt-3">
              Nothing stands out in the next ninety nights.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-grey-100">
              {suggestions.slice(0, 5).map((s) => (
                <li key={s.date} className="flex flex-col gap-0.5 py-3 first:pt-0">
                  <span className="text-sm font-medium text-ink-900">{s.text}</span>
                  <span className="text-sm text-grey-600">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-2xs text-grey-500 mt-3">
            A suggestion never names a price, and nothing here sets one.
            The Rate calendar is where a rate is changed.
          </p>
        </CardBody>
      </Card>

      {/* Which dates are soft. */}
      <h2 className="text-md font-semibold text-ink-900">
        Dates worth a look
      </h2>
      <p className="text-2xs text-grey-500 mt-0.5 mb-3">
        New 1 day, 7 days and 30 days: how many of the rooms sold for that
        night were booked in that long{today
          ? `, counted back from ${dateShort(today)}, the property's own day`
          : ""}.{noPickup ? ` ${noPickup}` : ""}
      </p>
      <DataTable
        columns={columns}
        rows={soft.length ? soft : days}
        rowKey={(d) => d.date}
        loading={outlook.isLoading}
        empty={
          <EmptyState
            title="No nights ahead yet"
            description={
              "Once there are bookings on the books for the coming nights, "
              + "they appear here with how full each one is."
            }
            compact
          />
        }
      />
    </Page>
  );
}

/* This month against the same month last year. Where there is no last
   year, it SAYS SO - a property that had not opened had nothing to
   sell, and nil available is not nought per cent (D17-93). */
function Pace({
  now, ahead, weekAgo,
}: {
  now: { occupancyPct: number; roomsSold: number; availableRoomNights: number };
  ahead: number | null;
  /** Rooms on the books for this month a week ago, or null where the
      records do not reach back that far (RM-1). */
  weekAgo: number | null;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-4">
      <Figure label="Occupancy" value={percent(now.occupancyPct)} />
      <Figure label="Rooms sold" value={String(now.roomsSold)} />
      <Figure label="Room nights" value={String(now.availableRoomNights)} />
      <Figure
        label="Against last year"
        value={orDash(ahead, (n) => `${n > 0 ? "+" : ""}${percent(n)}`)}
        {...(ahead === null ? { note: "The property was not selling then." } : {})}
      />
      {/* Where the month stood a week ago. The note is not decoration:
          it is the difference between "the books said this last week"
          and "this much of today's book was already there", and the two
          differ by exactly the week's cancellations. */}
      <Figure
        label="A week ago"
        className="max-sm:col-span-2"
        value={orDash(weekAgo, String)}
        {...(weekAgo === null
          ? { note: "The records do not reach back a week." }
          : { note: `${now.roomsSold - weekAgo} rooms booked since, still on the books.` })}
      />
    </div>
  );
}

function Figure({ label, value, note, className }: {
  label: string; value: string; note?: string; className?: string;
}) {
  return (
    <div className={cn("row-span-3 grid grid-rows-subgrid gap-y-0.5 min-w-0", className)}>
      <div className="text-sm font-medium text-grey-600 whitespace-nowrap">{label}</div>
      <div className={cn("text-xl sm:text-2xl font-semibold tabular-nums",
                         value === "-" ? "text-grey-500" : "text-ink-900")}>{value}</div>
      <div className="text-2xs text-grey-500">{note}</div>
    </div>
  );
}
