import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Lightbulb, TrendingUp } from "lucide-react";
import { dateShort, percent } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, DataTable, EmptyState, ErrorState,
  Skeleton, StatusPill, type Column,
} from "@/components/ui";
import { getOutlook, getPace } from "@/modules/revenue-management/data/outlook";
import {
  aheadBy, softestFirst, suggest, temperOf, type DateAhead,
} from "@/modules/revenue-management/logic/outlook";

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
      <Card className="mb-6">
        <CardBody>
          <h2 className="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <TrendingUp className="size-4 text-grey-500" />
            This month, on the books
          </h2>

          {pace.isLoading || outlook.isLoading ? (
            <Skeleton className="h-16 mt-4" />
          ) : !pace.data ? (
            <p className="text-sm text-grey-600 mt-3">
              No figures for this property yet.
            </p>
          ) : (
            <Pace now={pace.data.now} ahead={aheadBy(pace.data)} />
          )}
        </CardBody>
      </Card>

      {/* What it would suggest: a sentence, and its reason. */}
      <Card className="mb-6">
        <CardBody>
          <h2 className="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <Lightbulb className="size-4 text-grey-500" />
            What to consider
          </h2>

          {outlook.isLoading ? (
            <Skeleton className="h-16 mt-4" />
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-grey-600 mt-3">
              Nothing stands out in the next ninety nights.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {suggestions.slice(0, 5).map((s) => (
                <li key={s.date} className="flex flex-col gap-0.5">
                  <span className="text-base text-ink-900">{s.text}</span>
                  <span className="text-sm text-grey-600">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-2xs text-grey-500 mt-4">
            A suggestion never names a price, and nothing here sets one.
            The Rate calendar is where a rate is changed.
          </p>
        </CardBody>
      </Card>

      {/* Which dates are soft. */}
      <h2 className="text-sm font-semibold text-ink-900 mb-3">
        Dates worth a look
      </h2>
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
  now, ahead,
}: {
  now: { occupancyPct: number; roomsSold: number; availableRoomNights: number };
  ahead: number | null;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-5">
      <Figure label="Occupancy" value={percent(now.occupancyPct)} />
      <Figure label="Rooms sold" value={String(now.roomsSold)} />
      <Figure label="Room nights" value={String(now.availableRoomNights)} />
      <Figure
        label="Against last year"
        value={orDash(ahead, (n) => `${n > 0 ? "+" : ""}${percent(n)}`)}
        {...(ahead === null ? { note: "The property was not selling then." } : {})}
      />
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-grey-500">{label}</div>
      <div className="text-lg font-semibold text-ink-900 tabular-nums mt-0.5">{value}</div>
      {note ? <div className="text-2xs text-grey-500 mt-0.5">{note}</div> : null}
    </div>
  );
}
