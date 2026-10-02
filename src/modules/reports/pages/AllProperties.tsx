import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronRight, Hotel, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, DataTable, IconChip, InfoButton, ReadFailed, Skeleton, readError, type Column,
} from "@/components/ui";
import { notificationsRepo, type Notification, type PeriodStatistics } from "@/data/repositories";
import { getPeriodStatistics } from "@/modules/reports/data/statistics";

/* ══════════════════════════════════════════════════════════════════
   ALL PROPERTIES — `/all-properties`, for the owner (D27-243)

   Every property on one page (Mews's group screen): the group in one navy
   summary, "Needs you" (what to act on, at every property), and a row per
   property - a card on a phone. It replaced the every-property table at
   the Dashboard's foot.

   Each property on ITS OWN business date and its own month so far. Last
   year is the same month a year back, and the group compares only the
   properties that had one, saying how many: a new property never drags
   the comparison down. A figure that did not come back is a dash, never
   a zero; a property whose figures failed says so.
   ══════════════════════════════════════════════════════════════════ */

const DASH = "-";
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
/** The same day a year back; 29 February becomes the 28th. */
const yearBack = (date: string) => `${Number(date.slice(0, 4)) - 1}${date.slice(4) === "-02-29" ? "-02-28" : date.slice(4)}`;

interface Row {
  code: string;
  name: string;
  businessDate: string;
  today: PeriodStatistics | null;
  month: PeriodStatistics | null;
  /** Null when the property did not trade in that month a year ago. */
  lastYear: PeriodStatistics | null;
  waiting: Notification[];
}

/* ponytail: "had a last year" = sold a room that month a year back; a
   property that traded but sold nothing all month counts as none. */
const hadOne = (s: PeriodStatistics | null) => (s && s.roomsSold > 0 ? s : null);

async function readAll(hotels: { code: string; name: string; businessDate: string }[]): Promise<Row[]> {
  return Promise.all(hotels.map(async (h) => {
    const d = h.businessDate;
    const [today, month, lastYear, waiting] = await Promise.all([
      getPeriodStatistics(h.code, d, d),
      getPeriodStatistics(h.code, monthStart(d), d),
      getPeriodStatistics(h.code, yearBack(monthStart(d)), yearBack(d)),
      notificationsRepo.list(h.code).catch(() => [] as Notification[]),
    ]);
    return { code: h.code, name: h.name, businessDate: d, today, month, lastYear: hadOne(lastYear), waiting };
  }));
}

/** Rates from the totals, never averaged from each property's rates. */
function add(list: (PeriodStatistics | null)[]) {
  if (list.length === 0 || list.some((s) => s == null)) return null;
  const all = list as PeriodStatistics[];
  const available = all.reduce((t, s) => t + s.availableRoomNights, 0);
  const sold = all.reduce((t, s) => t + s.roomsSold, 0);
  const revenue = all.reduce((t, s) => t + s.roomRevenue, 0);
  return {
    occupancy: available ? Math.round((sold / available) * 10000) / 100 : null,
    arr: sold ? revenue / sold : null,
    revpar: available ? revenue / available : null,
    revenue,
  };
}

const pct = (n: number | null | undefined) => (n == null ? DASH : `${n}%`);
const cash = (n: number | null | undefined) => (n == null ? DASH : money(n));
/** Room revenue against the same month last year, in whole percent. */
const change = (now: number | null | undefined, then: number | null | undefined) =>
  now == null || !then ? null : Math.round(((now - then) / then) * 100);

export default function AllPropertiesPage() {
  const hotels = useSession((s) => s.hotels);
  const query = useQuery({
    queryKey: ["all-properties", hotels.map((h) => `${h.code}@${h.businessDate}`).join()],
    queryFn: () => readAll(hotels),
    enabled: hotels.length > 0,
  });
  const rows = query.data ?? [];
  const failed = readError(query);

  const today = add(rows.map((r) => r.today));
  const month = add(rows.map((r) => r.month));
  const withLastYear = rows.filter((r) => r.lastYear);
  const lastYear = add(withLastYear.map((r) => r.lastYear));
  const sameMonthNow = add(withLastYear.map((r) => r.month));
  const vs = change(sameMonthNow?.revenue, lastYear?.revenue);
  const waiting = rows.flatMap((r) => r.waiting.filter((n) => n.actionRequired).map((n) => ({ row: r, n })));

  return (
    <Page>
      <PageHeader
        title="All properties"
        description={`${hotels.length} ${hotels.length === 1 ? "property" : "properties"} · each on its own business date`}
      />

      {failed ? (
        <ReadFailed error={failed} what="every property's figures" onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-3">
          {/* ── The group: today, the month so far, the month last year ── */}
          <section aria-label="The group" className="rounded-lg bg-ink-900 text-white px-4 py-3.5 sm:px-[18px] sm:py-4">
            <div className="flex items-center gap-2.5 mb-3 text-sm font-medium text-white/72">
              <IconChip tone="glass"><Hotel /></IconChip>
              The group today
              <span className="ml-auto text-xs tabular">
                {query.isLoading ? null : `Last year: ${withLastYear.length} of ${rows.length} properties`}
              </span>
              <InfoButton className="text-white/60 hover:bg-white/10 hover:text-white">
                {"Every property added up, each on its own business date. Last year is the same month a year back, and counts only the properties that sold a room in it."}
              </InfoButton>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-0">
              {([
                ["Occupancy", pct(today?.occupancy), pct(month?.occupancy), pct(lastYear?.occupancy), "Month last year"],
                ["Average rate (ARR)", cash(today?.arr), cash(month?.arr), cash(lastYear?.arr), "Month last year"],
                ["RevPAR", cash(today?.revpar), cash(month?.revpar), cash(lastYear?.revpar), "Month last year"],
                ["Room revenue", cash(today?.revenue), cash(month?.revenue), vs == null ? DASH : `${vs > 0 ? "+" : ""}${vs}%`, "vs last year"],
              ] as const).map(([label, now, so, then, thenLabel]) => (
                <div key={label} className="grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-1 xl:gap-y-1.5 xl:px-4 xl:first:pl-0 xl:last:pr-0 xl:border-l xl:first:border-l-0 xl:border-white/12
                                            max-xl:border-t max-xl:border-white/12 max-xl:pt-3 max-sm:first:border-t-0 max-sm:first:pt-0
                                            sm:max-xl:[&:nth-child(-n+2)]:border-t-0 sm:max-xl:[&:nth-child(-n+2)]:pt-0">
                  <dt className="text-sm text-white/72">{label}</dt>
                  <dd className="text-xl sm:text-2xl font-semibold tabular tracking-[-0.02em] max-xl:text-right">
                    {query.isLoading ? <Skeleton className="h-7 w-20 inline-block bg-white/15" /> : now}
                  </dd>
                  <dd className="flex flex-col xl:flex-row xl:justify-between gap-0.5 text-xs text-white/72">
                    <span>Month so far</span><b className="text-sm xl:text-xs font-semibold text-white tabular">{so}</b>
                  </dd>
                  <dd className="flex flex-col xl:flex-row xl:justify-between gap-0.5 text-xs text-white/72">
                    <span>{thenLabel}</span><b className="text-sm xl:text-xs font-semibold text-white tabular">{then}</b>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ── Needs you: what to act on, at every property ─────────── */}
          <Card>
            <CardBody className="sm:px-[18px] sm:py-4">
              <h2 className="text-md font-semibold text-ink-900 mb-3">Needs you</h2>
              {query.isLoading ? <Skeleton className="h-10 w-full" /> : waiting.length === 0 ? (
                <p className="flex items-center gap-3.5 min-h-14">
                  <IconChip tone="green"><Check /></IconChip>
                  <span className="text-sm text-ink-900">Nothing waiting at any property</span>
                </p>
              ) : (
                <ul className="divide-y divide-grey-100">
                  {waiting.map(({ row, n }) => {
                    const body = (
                      <>
                        <IconChip tone="orange"><TriangleAlert /></IconChip>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-900">{row.name}: {n.title}</span>
                          {n.body && <span className="block text-xs text-grey-500 mt-0.5">{n.body}</span>}
                        </span>
                        {n.link && <ChevronRight className="size-4 text-grey-500 shrink-0" aria-hidden />}
                      </>
                    );
                    const cls = "flex items-center gap-3.5 min-h-14 py-3";
                    return (
                      <li key={`${row.code}-${n.id}`}>
                        {n.link ? (
                          <Link to={n.link} className={cn(cls, "hover:bg-grey-50 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange")}>{body}</Link>
                        ) : <div className={cls}>{body}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* ── Each property: today on top, the month so far under it ── */}
          <DataTable<Row> rows={rows} columns={columns} rowKey={(r) => r.code} loading={query.isLoading} />
        </div>
      )}
    </Page>
  );
}

/** Today's figure over the month so far's. */
const two = (now: string, so: string) => (
  <span className="inline-flex flex-col items-end tabular">
    <span className="font-semibold text-ink-900">{now}</span>
    <span className="text-xs text-grey-500">{so}</span>
  </span>
);

const columns: Column<Row>[] = [
  {
    key: "property",
    header: "Property",
    cell: (r) => (
      <Link to={`/h/${r.code}/stay`} className="group inline-flex flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink-900 group-hover:text-brand-orange-700">
          {r.name}
          <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
        </span>
        <span className="text-xs text-grey-500 tabular">{dateShort(r.businessDate)}</span>
      </Link>
    ),
  },
  { key: "occ", header: "Occupancy", numeric: true, cell: (r) => two(pct(r.today?.occupancyPct), pct(r.month?.occupancyPct)) },
  { key: "arr", header: "Average rate (ARR)", numeric: true, cell: (r) => two(cash(r.today?.roomsSold ? r.today.adr : null), cash(r.month?.roomsSold ? r.month.adr : null)) },
  { key: "revpar", header: "RevPAR", numeric: true, cell: (r) => two(cash(r.today?.revpar), cash(r.month?.revpar)) },
  { key: "revenue", header: "Room revenue", numeric: true, cell: (r) => two(cash(r.today?.roomRevenue), cash(r.month?.roomRevenue)) },
  {
    key: "vs", header: "vs last year", numeric: true,
    cell: (r) => {
      const v = change(r.month?.roomRevenue, r.lastYear?.roomRevenue);
      if (v == null) {
        return (
          <span className="inline-flex flex-col items-end">
            <span className="text-grey-500">{DASH}</span>
            <span className="text-xs text-grey-500">No last year yet</span>
          </span>
        );
      }
      const Icon = v >= 0 ? ArrowUp : ArrowDown;
      return (
        <span className="inline-flex flex-col items-end">
          <span className={cn("inline-flex items-center gap-1 font-semibold tabular", v > 0 ? "text-success-600" : "text-grey-700")}>
            <Icon className="size-3.5" aria-hidden />{Math.abs(v)}%
          </span>
          <span className="text-xs text-grey-500">Month so far</span>
        </span>
      );
    },
  },
];
