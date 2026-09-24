import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowRight, ChevronRight, BedDouble, IndianRupee, TrendingUp, Banknote,
  LogIn, LogOut, Users, DoorOpen, SprayCan, Wrench, Wallet, ReceiptText,
  Building2, UserX, ClipboardList, ChartColumn, Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Section, Card, CardBody, DataTable, Skeleton, NativeSelect, Term,
  ReadFailed, readError, type Column,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import type { TermKey } from "@/lib/glossary";
import { listProperties, BUSINESS_DATE, type Property } from "@/data/repositories";
import { listArrivalsOutstanding, getStayViewCounts } from "@/modules/front-desk";
import { getPeriodStatistics } from "@/modules/reports/data/statistics";
import { getReport, type ReportDoc } from "@/modules/reports/data/document";

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

const DASH = "-";

/** The first of the month the business date falls in — the Manager
    Report's period-to-date window, so the tiles and the report agree. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

type Figure = { today: number | null; ptd: number | null; ytd: number | null };

/** A row of the Manager report, found by its section and the label it
    prints. A figure the report does not hold stays null: a dash. */
function pick(doc: ReportDoc | null | undefined, section: string, label: string): Figure | undefined {
  const r = doc?.sections.find((s) => s.key === section)?.rows.find((x) => x.cells["label"] === label);
  if (!r) return undefined;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { today: num(r.cells["today"]), ptd: num(r.cells["ptd"]), ytd: num(r.cells["ytd"]) };
}

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
    queryFn: () => getReport(code, "manager", { asOn: date }),
    enabled: Boolean(code),
  });
  const counts = useQuery({
    queryKey: ["dashboard-counts", code, date],
    queryFn: () => getStayViewCounts(code, date),
    enabled: Boolean(code),
  });

  const r = report.data;
  const occ = pick(r, "statistics", "Occupancy Rate (%)");
  const adr = pick(r, "statistics", "Average Daily Rate (ADR)");
  const revpar = pick(r, "statistics", "Revenue Per Available Room");
  const roomRev = pick(r, "room-charges", "Room Charges");
  const payToday = pick(r, "payment", "Total Payment");
  const methods = (r?.sections.find((x) => x.key === "payment")?.rows ?? [])
    .filter((p) => p.kind === "row" && typeof p.cells["today"] === "number" && p.cells["today"] !== 0)
    .map((p) => ({ label: String(p.cells["label"]), today: p.cells["today"] as number }));
  const noShow = pick(r, "room-summary", "No Show Rooms");
  const owedByGuests = pick(r, "guest-ledger", "Closing Balance*");
  const cityLedger = pick(r, "city-ledger", "Closing Balance");
  const c = counts.data;

  const loading = report.isLoading || counts.isLoading;
  /* A read that failed prints dashes too, and a dash here means "a figure
     this system does not hold yet" — so a failure has to say so, or the
     page tells the owner the business has no figures. */
  const failed = readError(report) ?? readError(counts);

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        /* Each part stays whole and carries its dot at its END, so a phone
           wraps between parts and never starts a line with a dot. */
        description={code
          ? (
            <>
              <span className="whitespace-nowrap">{hotel?.name ?? code} ·</span>{" "}
              <span className="whitespace-nowrap">business date {dateShort(date)} ·</span>{" "}
              <span className="whitespace-nowrap">month so far from {dateShort(monthStart(date))}</span>
            </>
          )
          : "No property to show yet."}
        actions={hotels.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-grey-600">
            <span className="hidden sm:inline">Property</span>
            <NativeSelect
              aria-label="Which property the figures are for"
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

      <StartHere className="mb-6" />

      {failed ? (
        <ReadFailed
          compact
          className="mb-8"
          error={failed}
          what="today's figures"
          onRetry={() => { void report.refetch(); void counts.refetch(); }}
        />
      ) : null}

      <div>
        {/* ── The numbers a hotel lives by ─────────────────────────── */}
        <TileGroup title="Today" note="Today, then the month so far and the year so far. The year runs from 1 April.">
          <Tile icon={BedDouble} lead label="Occupancy" term="occupancy" value={pct(occ?.today)} loading={loading}
                rows={[["Month so far", pct(occ?.ptd)], ["Year so far", pct(occ?.ytd)]]} />
          <Tile icon={IndianRupee} lead label="Average rate (ADR)" term="adr" value={cash(adr?.today)} loading={loading}
                rows={[["Month so far", cash(adr?.ptd)], ["Year so far", cash(adr?.ytd)]]} />
          <Tile icon={TrendingUp} lead label="RevPAR" term="revpar" value={cash(revpar?.today)} loading={loading}
                rows={[["Month so far", cash(revpar?.ptd)], ["Year so far", cash(revpar?.ytd)]]} />
          <Tile icon={Banknote} lead label="Room revenue" value={cash(roomRev?.today)} loading={loading}
                rows={[["Month so far", cash(roomRev?.ptd)], ["Year so far", cash(roomRev?.ytd)]]} />
        </TileGroup>

        {/* ── The house, now ───────────────────────────────────────── */}
        <TileGroup wide title="The house now" note="Counts for the business date. Each opens the list behind it.">
          <Tile icon={LogIn} label="Arrivals" value={count(c?.["Arrivals"])} loading={loading}
                to={`/h/${code}/arrivals`} />
          <Tile icon={Users} label="In house" value={count(c?.["Occupied"])} loading={loading}
                to={`/h/${code}/in-house`} />
          <Tile icon={LogOut} label="Due out" value={count(c?.["Due Out"])} loading={loading}
                to={`/h/${code}/in-house/due-out`} />
          <Tile icon={DoorOpen} label="Empty" value={count(c?.["Vacant"])} loading={loading}
                to={`/h/${code}/stay`} />
          {/* Warm only when there is something to do about it. A zero
              dirty count in orange is a false alarm every morning. */}
          <Tile icon={SprayCan} label="Needs cleaning" value={count(c?.["Dirty"])} loading={loading}
                tone={(c?.["Dirty"] ?? 0) > 0 ? "warning" : undefined}
                to={`/h/${code}/housekeeping`} />
          <Tile icon={Wrench} label="Out of service" value={count(c?.["Blocked"])} loading={loading}
                tone={(c?.["Blocked"] ?? 0) > 0 ? "warning" : undefined}
                to={`/h/${code}/stay`} />
        </TileGroup>

        {/* ── Money ────────────────────────────────────────────────── */}
        <TileGroup title="Money" note="From the same figures as the Manager Report. A dash is a figure this system does not hold yet, never a zero.">
          {/* One row per way of paying, like the month and year under the
              figures above — packed behind middle dots they ran together
              once a second method arrived. */}
          <Tile icon={Wallet} label="Collected today" value={cash(payToday?.today)} loading={loading}
                {...(methods.length
                  ? { rows: methods.map((m): [string, string] => [m.label, money(m.today)]) }
                  : { note: "Nothing taken yet today" })} />
          <Tile icon={ReceiptText} label="Owed by guests, less refunds" term="guestLedger" value={cash(owedByGuests?.today)}
                loading={loading} note="Every guest bill still open" />
          <Tile icon={Building2} label="City ledger" term="cityLedger" value={cash(cityLedger?.today)}
                loading={loading} note="Shows a dash until company payments are recorded." />
          <Tile icon={UserX} label="No-shows" value={count(noShow?.today)} loading={loading}
                tone={(noShow?.today ?? 0) > 0 ? "warning" : undefined}
                rows={[["Month so far", count(noShow?.ptd)]]} to="/reports/no-show" />
        </TileGroup>

        {/* ── Quick reports ────────────────────────────────────────── */}
        <Section title="Quick reports">
          <div className="flex flex-wrap gap-2">
            {QUICK_REPORTS.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                className="group inline-flex items-center gap-2 min-h-11 px-3.5 rounded-md
                           border border-grey-300 bg-white text-base text-ink-900
                           hover:border-grey-400 hover:bg-grey-50 transition-colors duration-150
                           focus-visible:outline-2 focus-visible:outline-brand-orange"
              >
                <q.icon
                  className="size-4 text-grey-500 group-hover:text-brand-orange transition-colors duration-150"
                  aria-hidden
                />
                {q.label}
              </Link>
            ))}
          </div>
        </Section>

        {/* ── Every hotel, for somebody who reads more than one ───── */}
        {hotels.length > 1 && <EveryHotel />}
      </div>
    </Page>
  );
}

/* One icon each, not five copies of the same page glyph. Five identical
   document icons carry no information — they only take the space that
   tells the eye which link is which. */
const QUICK_REPORTS: Array<{ label: string; to: string; icon: LucideIcon }> = [
  { label: "Manager report", to: "/reports/manager", icon: ClipboardList },
  { label: "Monthly statistics", to: "/reports/monthly-stats", icon: ChartColumn },
  { label: "Lodging tax", to: "/reports/lodging-tax", icon: Landmark },
  { label: "City ledger", to: "/reports/city-ledger", icon: Building2 },
  { label: "No show", to: "/reports/no-show", icon: UserX },
];

/** A count is a real zero when nothing is there — unlike money, where an
    unknown is a dash. Unknown here (still loading, or it failed) is a dash. */
const count = (n: number | null | undefined) => (n == null ? DASH : String(n));

function TileGroup({ title, note, children, wide }: {
  title: string; note: string; children: ReactNode;
  /** Six short counts read as one row, not a row of four and an orphan
      pair. The groups are different shapes because they hold different
      things — which is also what stops the page reading as one wall. */
  wide?: boolean;
}) {
  /* The design system's own Section: the note sits UNDER its heading. It
     used to float at the far right of the heading's line, a screen's
     width from the word it explains.

     Four tiles are two rows of two below xl — three columns left the
     fourth alone on a row of its own on every 1024 desk screen. On a
     phone the four lead with the figure and a column of their own, where
     two across wrapped "Month so far" away from its number. */
  return (
    <Section title={title} description={note}>
      <div className={cn(
        "grid gap-3",
        wide ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
      )}>
        {children}
      </div>
    </Section>
  );
}

/* A tile carries its own icon, and the icon is the fastest thing on the
   screen to find: a clerk looking for "how many are dirty" recognises
   the spray can a beat before they have read the word. One family
   (lucide), one size, one stroke — a second icon set on this page would
   cost more than it adds.

   `lead` is the only size difference, and it is deliberate. Fourteen
   identically-weighted tiles are a wall: nothing on it is the headline,
   so the eye starts at the top left and reads all of them. The four
   figures a hotel is actually judged by are set larger, and the rest sit
   below them. */
function Tile({ icon: Icon, label, value, rows, note, to, tone, loading, lead, term }: {
  icon: LucideIcon;
  label: string; value: string;
  /** Makes the label tappable for its meaning. Ignored on a linked tile:
      a button inside the link would be invalid, and the tap would follow
      the link instead of explaining anything. */
  term?: TermKey;
  /** The figure's breakdown, a label and its value per row — the month
      and the year, or each way of paying. The values sit in one column on
      the right, so the eye runs down the numbers instead of reading a
      sentence to find them. */
  rows?: Array<[string, string]>;
  /** A line of words under the figure, where there is nothing to break
      it down into. */
  note?: string;
  to?: string;
  tone?: "warning"; loading?: boolean; lead?: boolean;
}) {
  const below = rows?.length || note;
  /* A dash is "not held yet", not a figure: it keeps the figure's size
     so the tiles line up, but not the ink that says "read me". */
  const missing = value === DASH;
  const body = (
    <CardBody className="p-4 h-full flex flex-col">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid place-items-center size-8 rounded-md shrink-0",
            tone === "warning"
              ? "bg-brand-orange-50 text-brand-orange-700"
              : "bg-grey-100 text-grey-500",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="text-sm text-grey-600 min-w-0">
          {term && !to ? <Term name={term}>{label}</Term> : label}
        </p>
      </div>

      {/* A count with nothing under it sits at the foot of its tile, so a
          row of six lines up on its numbers even where a label ran to two
          lines. The chevron rides with the number, which gives the label
          the width it wraps without. */}
      <div className={cn("flex items-center justify-between gap-2 mt-2.5", !below && "mt-auto pt-2.5")}>
        {loading ? (
          <Skeleton className={cn("w-24", lead ? "h-9" : "h-8")} />
        ) : (
          <p className={cn(
            "font-semibold tabular",
            lead ? "text-3xl" : "text-2xl",
            missing ? "text-grey-500"
              : tone === "warning" ? "text-brand-orange-700" : "text-ink-900",
          )}>
            {value}
          </p>
        )}
        {to && (
          <ChevronRight
            className="size-4 shrink-0 text-grey-300 transition-all duration-150
                       group-hover:text-grey-500 group-hover:translate-x-0.5"
            aria-hidden
          />
        )}
      </div>

      {below && (loading ? (
        <Skeleton className="h-4 w-32 mt-3" />
      ) : rows?.length ? (
        <dl className="mt-3 pt-3 border-t border-grey-100 space-y-1">
          {rows.map(([name, figure]) => (
            <div key={name} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-grey-600">{name}</dt>
              <dd className={cn("tabular", figure === DASH ? "text-grey-500" : "text-ink-900")}>{figure}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-grey-600 mt-1 leading-snug">{note}</p>
      ))}
    </CardBody>
  );

  if (!to) return <Card className="h-full">{body}</Card>;
  return (
    /* The focus ring follows the card's own corner (radius-md), not a
       larger one drawn around it. */
    <Link
      to={to}
      className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
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

/** Each hotel on ITS OWN operating day and its own month so far. This
    table read every row on the date of the hotel in view — BUSINESS_DATE
    and the period that goes with it — so with Agra a day behind Pune,
    Agra's "arrivals due" were Pune's tomorrow (21 September). */
async function buildRows(dates: Map<string, string>): Promise<Row[]> {
  const properties = await listProperties();
  return Promise.all(
    properties.map(async (property) => {
      const date = dates.get(property.id) ?? BUSINESS_DATE;
      const stats = await getPeriodStatistics(property.id, monthStart(date), date);
      /* STILL TO COME, not everyone whose date is today. A guest who has
         already checked in is not due. */
      const arrivals = await listArrivalsOutstanding(property.id, date);
      const counts = await getStayViewCounts(property.id, date);
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
        className="group inline-flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-orange-700 transition-colors duration-150"
      >
        {r.property.name}
        <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150" aria-hidden />
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
    key: "dirty", header: "Needs cleaning", numeric: true,
    cell: (r) => (
      <span className={r.dirty > 0 ? "tabular font-medium text-brand-orange-700" : "tabular text-grey-600"}>
        {r.dirty}
      </span>
    ),
  },
];

function EveryHotel() {
  const hotels = useSession((s) => s.hotels);
  const dates = new Map(hotels.map((h) => [h.code, h.businessDate]));
  const query = useQuery({
    queryKey: ["dashboard", [...dates].join()],
    queryFn: () => buildRows(dates),
  });
  const { data, isLoading } = query;
  const failed = readError(query);

  return (
    <Section title="Every property" description="The month so far. Each reconciles to that property's Manager report.">
      <Card>
        {failed ? (
          /* Not an empty table: a group whose figures failed to load is
             not a group with no hotels. */
          <ReadFailed compact error={failed} what="every property's figures" onRetry={() => void query.refetch()} />
        ) : isLoading ? (
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
    </Section>
  );
}
