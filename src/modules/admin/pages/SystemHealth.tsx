import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, HardDrive, Server, ShieldCheck, Timer } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateShort, dateTime, number } from "@/lib/format";
import {
  Card, CardBody, CardHeader, DataTable, ErrorState, FigureRow, FigureTile, Page, PageHeader,
  Segmented, SkeletonCards, StatusPill, type Column,
} from "@/components/ui";
import { auditLag, getSystemHealth, type SystemHealth, type Traffic } from "@/modules/admin/data/systemHealth";

/* ══════════════════════════════════════════════════════════════════
   SYSTEM HEALTH (the owner's D27-91, 28 September): "a GUI for the
   server so that I understand what is going on". For the owner and an
   administrator; everything on it is the server's own record, and the
   traffic names routes, never a guest.
   ══════════════════════════════════════════════════════════════════ */

const bytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;

const ms = (n: number) => (n >= 1000 ? `${n / 1000} s` : `${n} ms`);

/** "within 250 ms", "over 10 s", or a dash with nothing to measure. */
const within = (p95: number | null) => (p95 === null ? "-" : p95 === -1 ? "over 10 s" : `within ${ms(p95)}`);

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** A small line of one figure over the period, oldest on the left. */
function Spark({ values, className }: { values: number[]; className?: string }) {
  const top = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${29 - (v / top) * 27}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden className={`block h-8 w-full ${className ?? ""}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const PERIODS = [
  { value: "hour", label: "Last hour" },
  { value: "day", label: "Last day" },
  { value: "week", label: "Last week" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

function TrafficTiles({ t }: { t: Traffic }) {
  return (
    <FigureRow className="grid-cols-1 sm:grid-cols-3">
      <FigureTile icon={<Activity />} label="Requests" value={number(t.requests)}
        note={<Spark values={t.series.map((s) => s.requests)} className="text-grey-500" />} />
      {/* The Signal Rule: orange only when there is something to look at. */}
      <FigureTile icon={<AlertTriangle />} tone={t.errors > 0 ? "orange" : "neutral"} label="Server errors"
        value={number(t.errors)}
        note={<Spark values={t.series.map((s) => s.errors)} className={t.errors > 0 ? "text-brand-orange" : "text-grey-500"} />} />
      <FigureTile icon={<Timer />} label="95 in 100 answered" value={within(t.p95Ms)} missing={t.p95Ms === null}
        note={<Spark values={t.series.map((s) => (s.p95Ms === -1 ? 20000 : s.p95Ms ?? 0))} className="text-grey-500" />} />
    </FigureRow>
  );
}

type HotelRow = SystemHealth["hotels"][number];

function AuditPill({ h }: { h: HotelRow }) {
  const lag = auditLag(h.businessDate, h.today);
  if (lag <= 0) return <StatusPill tone="success">Up to date</StatusPill>;
  if (lag === 1) return <StatusPill tone="warning">Yesterday not closed yet</StatusPill>;
  return <StatusPill tone="danger">Behind by {lag} days</StatusPill>;
}

const HOTEL_COLUMNS: Column<HotelRow>[] = [
  { key: "hotel", header: "Hotel", cell: (h) => <span className="font-medium text-ink-900">{h.name}</span> },
  { key: "date", header: "Business date", cell: (h) => dateShort(h.businessDate) },
  { key: "audit", header: "Last night audit", cell: (h) => (h.lastAuditAt ? dateTime(h.lastAuditAt) : "-") },
  { key: "state", header: "Day", cell: (h) => <AuditPill h={h} /> },
];

type Slow = SystemHealth["slowest"][number];
const SLOW_COLUMNS: Column<Slow>[] = [
  { key: "route", header: "Route", cell: (r) => <code className="text-xs break-all">{r.method} {r.route}</code> },
  { key: "n", header: "Requests", numeric: true, cell: (r) => number(r.requests) },
  { key: "avg", header: "Average", numeric: true, cell: (r) => ms(r.avgMs) },
  { key: "max", header: "Slowest", numeric: true, cell: (r) => ms(r.maxMs) },
];

type Problem = { key: string; what: string; where: string; count: number; last: string };
const PROBLEM_COLUMNS: Column<Problem>[] = [
  { key: "what", header: "What", cell: (p) => <code className="text-xs break-all">{p.what}</code> },
  { key: "where", header: "Where", cell: (p) => <code className="text-xs break-all">{p.where}</code> },
  { key: "n", header: "Times", numeric: true, cell: (p) => number(p.count) },
  { key: "last", header: "Last", numeric: true, cell: (p) => dateTime(p.last) },
];

const BACKUP: Record<SystemHealth["backup"]["state"], { value: string; note: string }> = {
  passed: { value: "Restored and checked", note: "" },
  failed: { value: "Failed", note: "The nightly check failed. Read /var/log/fidato-backup.log on the server." },
  unknown: { value: "-", note: "The last run left no result. It may still be running." },
  none: { value: "-", note: "No nightly backup has run on this server." },
  unreadable: { value: "-", note: "The server may not read the backup log, so this cannot say." },
};
const OFFSITE: Record<NonNullable<SystemHealth["backup"]["offsite"]>, string> = {
  copied: "Copied",
  failed: "Failed",
  "this disk only": "This disk only",
};

export default function SystemHealthPage() {
  const hotel = useUi((s) => s.hotelId);
  const [period, setPeriod] = useState<Period>("day");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["system-health", hotel],
    queryFn: () => getSystemHealth(hotel),
    refetchInterval: 60_000,
  });

  const header = (
    <PageHeader title="System health"
      description="What the server is doing, from its own records. Nothing here leaves the server, and no guest is named. Counts are written every minute." />
  );
  if (error) return <Page>{header}<ErrorState error={error} onRetry={() => refetch()} /></Page>;
  if (isLoading || !data) return <Page>{header}<SkeletonCards count={4} /></Page>;

  const b = BACKUP[data.backup.state];
  const freeShare = data.disk ? data.disk.freeBytes / data.disk.totalBytes : null;
  const problems: Problem[] = [
    ...data.errors.map((e) => ({ key: `e${e.place}${e.what}`, what: `Error ${e.what}`, where: e.place, count: e.count, last: e.last })),
    ...data.slowQueries.map((q) => ({
      key: `q${q.what}`, what: q.what, where: `Slow query${q.maxMs ? `, up to ${ms(q.maxMs)}` : ""}`, count: q.count, last: q.last,
    })),
  ];

  return (
    <Page>
      {header}
      <div className="space-y-6">
        <FigureRow className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <FigureTile icon={<Server />} label="Server up for" value={uptime(data.uptimeSeconds)}
            rows={[["Version", <code key="v">{data.version}</code>], ["Started", dateTime(data.startedAt)]]} />
          <FigureTile icon={<Database />} label="Database" value={bytes(data.databaseBytes)}
            rows={[["Connections in use", `${data.pool.inUse} of ${data.pool.max}`], ["Waiting for one", number(data.pool.waiting)]]} />
          <FigureTile icon={<HardDrive />} tone={freeShare !== null && freeShare < 0.1 ? "orange" : "neutral"}
            label="Disk free" value={data.disk ? bytes(data.disk.freeBytes) : "-"} missing={!data.disk}
            {...(data.disk
              ? { rows: [["Of", bytes(data.disk.totalBytes)], ["Free", `${Math.round(freeShare! * 100)}%`]] as Array<[string, string]> }
              : { note: "The server did not say how much disk is free." })} />
          <FigureTile icon={<ShieldCheck />} tone={data.backup.state === "failed" ? "orange" : "neutral"}
            label="Last backup" value={b.value} missing={b.value === "-"}
            {...(data.backup.at && data.backup.state !== "none" && data.backup.state !== "unreadable"
              ? { rows: [["At", dateTime(data.backup.at)],
                         ["Copy off the server", data.backup.offsite ? OFFSITE[data.backup.offsite] : "-"]] as Array<[string, string]> }
              : { note: b.note })} />
        </FigureRow>

        <Card>
          <CardHeader title="Requests" description="Every request to the server, its result and how quickly it was answered." />
          <CardBody>
            {/* In the body, not the header's actions: at phone width it crushed the title. */}
            <Segmented className="mb-3" value={period} onChange={setPeriod} options={[...PERIODS]} />
            <TrafficTiles t={data.traffic[period]} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hotels" description="Each hotel's business date and its last night audit. A day left open loses its room nights." />
          <DataTable<HotelRow> rows={data.hotels} columns={HOTEL_COLUMNS} rowKey={(h) => h.code} />
        </Card>

        <Card>
          <CardHeader title="Slowest routes" description="The last day, slowest on average first." />
          <DataTable<Slow> rows={data.slowest} columns={SLOW_COLUMNS} rowKey={(r) => `${r.method} ${r.route}`}
            empty={<p className="p-5 text-sm text-grey-500">No requests in the last day.</p>} />
        </Card>

        {data.leadsReads && (
          <Card>
            {/* D27-170: the leads app's free allowance is 50,000 reads a day, shared with the app itself. */}
            <CardHeader title="Leads app reads"
              description="What this system read from the leads app, by Google's day: midnight to midnight Pacific time, 12:30 pm in India (1:30 pm in winter). The app's free allowance is 50,000 a day, shared with the app itself; this system stops at its own limit."
              actions={<span className="text-sm text-grey-600 tabular-nums">Limit {data.leadsReads.cap === null ? "-" : number(data.leadsReads.cap)} a day</span>} />
            <DataTable<{ day: string; reads: number }> rows={data.leadsReads.days} rowKey={(d) => d.day}
              columns={[
                { key: "day", header: "Day", cell: (d) => dateShort(d.day) },
                { key: "reads", header: "Reads", numeric: true, cell: (d) => number(d.reads) },
              ]}
              empty={<p className="p-5 text-sm text-grey-500">Nothing read from the leads app in the last week.</p>} />
          </Card>
        )}

        <Card>
          <CardHeader title="Errors and slow queries" description="The last week. An error is named by its kind, never by what it said, so no guest's details are kept." />
          <DataTable<Problem> rows={problems} columns={PROBLEM_COLUMNS} rowKey={(p) => p.key}
            empty={<p className="p-5 text-sm text-grey-500">None in the last week.</p>} />
        </Card>
      </div>
    </Page>
  );
}
