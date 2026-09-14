import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, DataTable, Skeleton, NativeSelect,
  type Column,
} from "@/components/ui";
import {
  listProperties, getPeriodStatistics, listArrivalsOutstanding,
  getStayViewCounts, getManagerReport, BUSINESS_DATE,
  type Property, type ThreeColumn,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — `/`

   Was "Group": a table with one row per property. The owner's call on
   14 September — it is the Dashboard, it shows the numbers a hotel lives
   by, and it has quick reports. For somebody who reads several hotels,
   tiles for the one picked at the top and the table of every hotel
   below it.

   ⚠ EVERY MONEY AND OCCUPANCY FIGURE HERE IS THE MANAGER REPORT'S. The
   tiles read the same endpoint, for the same business date and the same
   period, so the Dashboard and the report an owner prints cannot
   disagree by a rupee. Where the report prints a dash — a figure this
   system cannot derive yet — the tile prints the same dash, never a 0.
   ══════════════════════════════════════════════════════════════════ */

const DASH = "—";

/** The first of the month the business date falls in — the Manager
    Report's period-to-date window, so the tiles and the report agree. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** A row from the Manager Report, found by the label the report prints. */
const pick = (rows: ThreeColumn[] | undefined, label: string) =>
  rows?.find((r) => r.label === label);

const pct = (n: number | null | undefined) => (n == null ? DASH : `${n}%`);
const cash = (n: number | null | undefined) => (n == null ? DASH : money(n));

export default function DashboardPage() {
  const hotels = useSession((s) => s.hotels);
  const uiCode = useUi((s) => s.hotelId);

  /* Which hotel the tiles are about: one picked here, else the one in
     view, else the first. The picker changes only this page — the rest
     of the app keeps the property it was on.

     ⚠ NOT A STATE SEEDED ON FIRST RENDER. The first version was
     `useState(() => uiCode ?? hotels[0])`, and the property in view is
     often not known yet on that render — so the tiles settled on the
     FIRST hotel in the list and stayed there, while the menu beside them
     was already on the right one. Found by the App test, whose tile
     linked to AGR under a sidebar on 5EL. */
  const [picked, setPicked] = useState<string | null>(null);
  /* THE PROPERTY IN VIEW IS THE CODE, as on every other screen — the
     session's list only adds its name and date. Looking the code up in
     that list and falling back to its first entry put AGR's tiles under
     a 5EL menu whenever the two lists disagreed. */
  const code = picked ?? uiCode ?? hotels[0]?.code ?? "";
  const hotel = hotels.find((h) => h.code === code);
  /* That hotel's OWN operating day — two properties are routinely on
     different dates, one audited and one not. */
  const date = hotel?.businessDate ?? BUSINESS_DATE;

  const report = useQuery({
    queryKey: ["dashboard-manager", code, date],
    queryFn: () => getManagerReport(code, date, monthStart(date)),
    enabled: Boolean(code),
  });
  const counts = useQuery({
    queryKey: ["dashboard-counts", code, date],
    queryFn: () => getStayViewCounts(code, date),
    enabled: Boolean(code),
  });

  const r = report.data;
  const stats = r?.statistics;
  const revenue = r?.sections.find((s) => s.title === "Revenue")?.rows;
  const paid = r?.sections.find((s) => s.title === "Payment")?.rows;
  const guestLedger = r?.sections.find((s) => s.title === "Guest Ledger")?.rows;
  const cityLedger = r?.sections.find((s) => s.title === "City Ledger")?.rows;

  const occ = pick(stats, "Occupancy Rate (%)");
  const adr = pick(stats, "Average Daily Rate (ADR)");
  const revpar = pick(stats, "Revenue Per Available Room");
  const roomRev = pick(revenue, "Room Charges");
  const payToday = pick(paid, "Total Payment");
  const methods = (paid ?? []).filter((p) => !p.total && (p.today ?? 0) !== 0);
  const noShow = pick(r?.roomSummary, "No Show Rooms");
  const c = counts.data;

  const loading = report.isLoading || counts.isLoading;

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description={code
          ? `${hotel?.name ?? code} · business date ${dateShort(date)} · month to date from ${dateShort(monthStart(date))}`
          : "No property to show yet."}
        actions={hotels.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-grey-600">
            <span className="hidden sm:inline">Hotel</span>
            <NativeSelect
              aria-label="Which hotel the figures are for"
              value={code}
              onChange={(e) => setPicked(e.currentTarget.value)}
              className="w-auto"
            >
              {hotels.map((h) => (
                <option key={h.code} value={h.code}>{h.name}</option>
              ))}
            </NativeSelect>
          </label>
        ) : undefined}
      />

      <div className="space-y-6">
        {/* ── The numbers a hotel lives by ─────────────────────────── */}
        <TileGroup title="Today" note="Today, then month to date and year to date (from 1 April).">
          <Tile label="Occupancy" value={pct(occ?.today)} loading={loading}
                sub={`MTD ${pct(occ?.ptd)} · YTD ${pct(occ?.ytd)}`} />
          <Tile label="Average rate (ADR)" value={cash(adr?.today)} loading={loading}
                sub={`MTD ${cash(adr?.ptd)} · YTD ${cash(adr?.ytd)}`} />
          <Tile label="RevPAR" value={cash(revpar?.today)} loading={loading}
                sub={`MTD ${cash(revpar?.ptd)} · YTD ${cash(revpar?.ytd)}`} />
          <Tile label="Room revenue" value={cash(roomRev?.today)} loading={loading}
                sub={`MTD ${cash(roomRev?.ptd)} · YTD ${cash(roomRev?.ytd)}`} />
        </TileGroup>

        {/* ── The house, now ───────────────────────────────────────── */}
        <TileGroup title="The house now" note="Counts for the business date. Each opens the list behind it.">
          <Tile label="Arrivals" value={count(c?.["Arrivals"])} loading={loading}
                to={`/h/${code}/arrivals`} />
          <Tile label="In house" value={count(c?.["Occupied"])} loading={loading}
                to={`/h/${code}/in-house`} />
          <Tile label="Due out" value={count(c?.["Due Out"])} loading={loading}
                to={`/h/${code}/in-house/due-out`} />
          <Tile label="Vacant" value={count(c?.["Vacant"])} loading={loading}
                to={`/h/${code}/stay`} />
          <Tile label="Dirty" value={count(c?.["Dirty"])} loading={loading}
                tone={(c?.["Dirty"] ?? 0) > 0 ? "warning" : undefined}
                to={`/h/${code}/housekeeping`} />
          <Tile label="Out of service" value={count(c?.["Blocked"])} loading={loading}
                to={`/h/${code}/stay`} />
        </TileGroup>

        {/* ── Money ────────────────────────────────────────────────── */}
        <TileGroup title="Money" note="From the same figures as the Manager Report. A dash is a figure this system does not hold yet, never a zero.">
          <Tile label="Collected today" value={cash(payToday?.today)} loading={loading}
                sub={methods.length
                  ? methods.map((m) => `${m.label} ${money(m.today ?? 0)}`).join(" · ")
                  : "Nothing taken yet today"} />
          <Tile label="Owed by guests" value={cash(pick(guestLedger, "Closing Balance")?.today)}
                loading={loading} sub="Every open folio balance" />
          <Tile label="City ledger" value={cash(pick(cityLedger, "Closing Balance")?.today)}
                loading={loading} sub="Settled outside the PMS today" />
          <Tile label="No-shows" value={count(noShow?.today)} loading={loading}
                sub={`MTD ${count(noShow?.ptd)}`} to="/reports/no-show" />
        </TileGroup>

        {/* ── Quick reports ────────────────────────────────────────── */}
        <section>
          <h2 className="text-md font-semibold text-ink-900 mb-2.5">Quick reports</h2>
          <div className="flex flex-wrap gap-2">
            {QUICK_REPORTS.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                className="inline-flex items-center gap-2 min-h-11 px-3.5 rounded-md
                           border border-grey-300 bg-white text-base text-ink-900
                           hover:border-grey-400 hover:bg-grey-50 transition-colors duration-150
                           focus-visible:outline-2 focus-visible:outline-brand-orange"
              >
                <FileText className="size-4 text-grey-500" aria-hidden />
                {q.label}
              </Link>
            ))}
          </div>
        </section>

        {/* ── Every hotel, for somebody who reads more than one ───── */}
        {hotels.length > 1 && <EveryHotel />}
      </div>
    </Page>
  );
}

const QUICK_REPORTS = [
  { label: "Manager Report", to: "/reports/manager" },
  { label: "Monthly Statistics", to: "/reports/monthly-stats" },
  { label: "Lodging Tax", to: "/reports/lodging-tax" },
  { label: "City Ledger", to: "/reports/city-ledger" },
  { label: "No Show", to: "/reports/no-show" },
];

/** A count is a real zero when nothing is there — unlike money, where an
    unknown is a dash. Unknown here (still loading, or it failed) is a dash. */
const count = (n: number | null | undefined) => (n == null ? DASH : String(n));

function TileGroup({ title, note, children }: {
  title: string; note: string; children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
        <h2 className="text-md font-semibold text-ink-900">{title}</h2>
        <p className="text-sm text-grey-600">{note}</p>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function Tile({ label, value, sub, to, tone, loading }: {
  label: string; value: string; sub?: string; to?: string;
  tone?: "warning"; loading?: boolean;
}) {
  const body = (
    <CardBody className="p-4">
      <p className="text-sm text-grey-600">{label}</p>
      {loading ? (
        <Skeleton className="h-8 w-24 mt-1.5" />
      ) : (
        <p className={cn(
          "text-2xl font-semibold tabular mt-0.5",
          tone === "warning" ? "text-brand-orange-700" : "text-ink-900",
        )}>
          {value}
        </p>
      )}
      {sub && <p className="text-sm text-grey-600 tabular mt-1 leading-snug">{sub}</p>}
    </CardBody>
  );

  if (!to) return <Card>{body}</Card>;
  return (
    <Link
      to={to}
      className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-brand-orange"
    >
      <Card className="h-full transition-colors duration-150 group-hover:border-grey-400">
        {body}
      </Card>
    </Link>
  );
}

/* ── Every hotel ─────────────────────────────────────────────────── */

interface Row {
  property: Property;
  /** Null when the statistics did not come back. Not zero — a property
      whose figures failed to load is not one that sold nothing. */
  occupancyPct: number | null;
  adr: number | null;
  revpar: number | null;
  arrivals: number;
  dirty: number;
}

async function buildRows(): Promise<Row[]> {
  const properties = await listProperties();
  return Promise.all(
    properties.map(async (property) => {
      const stats = await getPeriodStatistics(property.id);
      /* STILL TO COME, not everyone whose date is today. A guest who has
         already checked in is not due. */
      const arrivals = await listArrivalsOutstanding(property.id, BUSINESS_DATE);
      const counts = await getStayViewCounts(property.id, BUSINESS_DATE);
      /* NULL WHEN THE FIGURES DID NOT COME BACK, not zero. `dirty` is
         different: the count genuinely IS zero when no room is dirty. */
      return {
        property,
        occupancyPct: stats?.occupancyPct ?? null,
        adr: stats?.adr ?? null,
        revpar: stats?.revpar ?? null,
        arrivals: arrivals.length,
        dirty: counts.Dirty ?? 0,
      };
    }),
  );
}

const columns: Column<Row>[] = [
  {
    key: "property",
    header: "Property",
    cell: (r) => (
      <Link
        to={`/h/${r.property.id}/stay`}
        className="group inline-flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-orange transition-colors duration-150"
      >
        {r.property.name}
        <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </Link>
    ),
  },
  {
    key: "rooms", header: "Rooms", numeric: true,
    cell: (r) => <span className="tabular">{r.property.rooms}</span>,
  },
  {
    key: "occ", header: "Occupancy", numeric: true,
    cell: (r) => (
      <span className="tabular font-medium">
        {r.occupancyPct === null ? DASH : `${r.occupancyPct}%`}
      </span>
    ),
  },
  {
    key: "adr", header: "ADR", numeric: true,
    cell: (r) => <span className="tabular">{r.adr === null ? DASH : money(r.adr)}</span>,
  },
  {
    key: "revpar", header: "RevPAR", numeric: true,
    cell: (r) => <span className="tabular">{r.revpar === null ? DASH : money(r.revpar)}</span>,
  },
  {
    key: "arrivals", header: "Arrivals due", numeric: true,
    cell: (r) => <span className="tabular">{r.arrivals}</span>,
  },
  {
    key: "dirty", header: "Rooms dirty", numeric: true,
    cell: (r) => (
      <span className={r.dirty > 0 ? "tabular font-medium text-brand-orange-700" : "tabular text-grey-600"}>
        {r.dirty}
      </span>
    ),
  },
];

function EveryHotel() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", BUSINESS_DATE],
    queryFn: buildRows,
  });

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
        <h2 className="text-md font-semibold text-ink-900">Every hotel</h2>
        <p className="text-sm text-grey-600">Month to date. Each reconciles to that property's Manager Report.</p>
      </div>
      <Card>
        {isLoading ? (
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
          </CardBody>
        ) : (
          <DataTable<Row>
            rows={data ?? []}
            columns={columns}
            rowKey={(r) => r.property.id}
          />
        )}
      </Card>
    </section>
  );
}
