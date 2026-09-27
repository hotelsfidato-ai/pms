import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowRight, Check, ChevronRight, BedDouble, IndianRupee, TrendingUp, Banknote,
  LogIn, LogOut, Users, DoorOpen, SprayCan, Wrench, Wallet, ReceiptText,
  Building2, UserX, ClipboardList, ChartColumn, Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Section, Card, CardBody, DataTable, Skeleton, NativeSelect, Term,
  InfoButton, IconChip, Rings, AnchorGauge, ReadFailed, readError, type Column,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import type { TermKey } from "@/lib/glossary";
import { listProperties, BUSINESS_DATE, type Property } from "@/data/repositories";
import {
  listArrivalsOutstanding, getStayViewCounts, getStayView, fetchStays, type ChartRoom,
} from "@/modules/front-desk";
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

   27 SEPTEMBER, THE FIDATO LOOK (D22-47 to D22-51, the owner's yes to
   each piece that day): the navy Occupancy beside the three figures,
   Money, Today's run, the house as a strip of rooms over its six counts,
   then the quick reports. The section notes moved behind an (i), same
   words. Today's run and the strip count only what the system holds:
   today's bookings, and the Rooms board's own room states.
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

/** A count is a real zero when nothing is there — unlike money, where an
    unknown is a dash. Unknown here (still loading, or it failed) is a dash. */
const count = (n: number | null | undefined) => (n == null ? DASH : String(n));

/* The section notes, word for word as they stood under the headings. */
const NOTES = {
  today: "Today, then the month so far and the year so far. The year runs from 1 April.",
  house: "Counts for the business date. Each opens the list behind it.",
  money: "From the same figures as the Manager Report. A dash is a figure this system does not hold yet, never a zero.",
};

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
  /* The Rooms board's own view of the business date: its counts are the
     six below, its rooms are the strip, so the three can never disagree. */
  const view = useQuery({
    queryKey: ["dashboard-house", code, date],
    queryFn: () => getStayView(code, date, date, 1),
    enabled: Boolean(code),
  });
  const stays = useQuery({
    queryKey: ["dashboard-stays", code],
    queryFn: () => fetchStays(code),
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
  const c = view.data?.counts;
  const rooms = (view.data?.roomTypes ?? []).flatMap((t) => t.rooms)
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const loading = report.isLoading || view.isLoading;
  /* A read that failed prints dashes too, and a dash here means "a figure
     this system does not hold yet" — so a failure has to say so, or the
     page tells the owner the business has no figures. */
  const failed = readError(report) ?? readError(view) ?? readError(stays);

  /* TODAY'S RUN — the owner's yes, 27 September: only counts the system
     holds. Check-ins: today's arrivals checked in, of today's arrivals
     (no-shows and cancellations are not work). Check-outs: today's
     departures checked out, of today's departures. Rooms ready: empty
     rooms not waiting to be cleaned, of the empty rooms. */
  const run = (() => {
    if (!stays.data || !view.data) return null;
    const all = stays.data;
    const arriving = all.filter((s) => s.arrival === date && s.status !== "cancelled" && s.status !== "no-show");
    const leaving = all.filter((s) => s.departure === date
      && (s.status === "in-house" || s.status === "due-out" || s.status === "checked-out"));
    const empty = rooms.filter((x) => !x.outOfService && !x.state.occupied);
    return [
      { key: "in", label: "Check-ins", done: arriving.filter((s) => s.status !== "due-in").length, of: arriving.length, color: "var(--color-brand-orange)", track: "var(--color-brand-orange-100)", dot: "bg-brand-orange" },
      { key: "out", label: "Check-outs", done: leaving.filter((s) => s.status === "checked-out").length, of: leaving.length, color: "var(--color-brand-yellow)", track: "var(--color-brand-yellow-100)", dot: "bg-brand-yellow" },
      { key: "ready", label: "Rooms ready", done: empty.filter((x) => !x.state.dirty).length, of: empty.length, color: "var(--color-success)", track: "var(--color-success-100)", dot: "bg-success" },
    ];
  })();
  const toGo = run?.reduce((n, x) => n + (x.of - x.done), 0);

  const figures: Array<{ icon: LucideIcon; label: string; term?: TermKey; f?: Figure }> = [
    { icon: IndianRupee, label: "Average rate (ADR)", term: "adr", f: adr },
    { icon: TrendingUp, label: "RevPAR", term: "revpar", f: revpar },
    { icon: Banknote, label: "Room revenue", f: roomRev },
  ];
  const fig = (value: string, wide = "w-24") => (loading ? <Skeleton className={cn("h-7", wide)} /> : value);

  return (
    <Page>
      <PageHeader
        eyebrow={`Business date · ${dateLong(date)}`}
        title="Dashboard"
        /* Each part stays whole and carries its dot at its END, so a phone
           wraps between parts and never starts a line with a dot. */
        description={code
          ? (
            <>
              <span className="whitespace-nowrap">{hotel?.name ?? code} ·</span>{" "}
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

      <StartHere className="mb-5" />

      {failed ? (
        <ReadFailed
          compact
          className="mb-5"
          error={failed}
          what="today's figures"
          onRetry={() => { void report.refetch(); void view.refetch(); void stays.refetch(); }}
        />
      ) : null}

      <div className="grid grid-cols-12 gap-3">
        {/* ── The anchor: Occupancy, in navy ───────────────────────── */}
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-3 rounded-lg bg-ink-900 text-white px-4 py-3.5 sm:px-[18px] sm:py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-white/72">
            <IconChip tone="glass"><BedDouble /></IconChip>
            <Term name="occupancy" className="decoration-white/35">Occupancy</Term>
            <InfoButton className="ml-auto text-white/60 hover:bg-white/10 hover:text-white">{NOTES.today}</InfoButton>
          </div>
          <div className="flex-1 grid gap-4 sm:gap-6 items-center sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="grid grid-cols-[80px_auto] gap-4 items-center">
              <Rings seenKey="fidato.dashboard.rings" size="size-20" arcs={[{ value: occ?.today == null ? null : occ.today / 100, color: "var(--color-brand-orange)", track: "rgb(255 255 255 / 0.12)" }]} />
              <div>
                <p className={cn("text-3xl font-semibold tabular tracking-[-0.03em]", occ?.today == null && !loading && "text-white/55")}>
                  {fig(pct(occ?.today), "w-28 bg-white/15")}
                </p>
                <p className="text-xs text-white/55 mt-0.5">Today</p>
              </div>
            </div>
            <div className="grid gap-3">
              <Gauge label="Month so far" value={occ?.ptd} loading={loading} />
              <Gauge label="Year so far" value={occ?.ytd} loading={loading} />
            </div>
          </div>
        </div>

        {/* ── The figures: three tiles levelled by subgrid; on a phone,
            one card of blocks (the Data Rule) ─────────────────────── */}
        <div className="col-span-12 xl:col-span-7 grid gap-3 sm:grid-cols-3 sm:grid-rows-[auto_auto_auto]
                        max-sm:gap-0 max-sm:bg-white max-sm:border max-sm:border-grey-200 max-sm:rounded-lg max-sm:divide-y max-sm:divide-grey-200">
          {figures.map(({ icon: Icon, label, term, f }) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-3.5
                         sm:row-span-3 sm:grid-cols-1 sm:grid-rows-subgrid sm:items-start sm:gap-y-2.5
                         sm:bg-white sm:border sm:border-grey-200 sm:rounded-lg sm:px-[18px] sm:py-4"
            >
              <p className="flex items-start gap-2.5 text-sm font-medium leading-5 text-grey-600 min-w-0">
                <IconChip className="-mt-1 max-sm:hidden"><Icon /></IconChip>
                <span className="min-w-0">{term ? <Term name={term}>{label}</Term> : label}</span>
              </p>
              <p className={cn(
                "text-xl sm:text-2xl leading-[30px] font-semibold tabular tracking-[-0.022em] text-right sm:text-left",
                f?.today == null && !loading ? "text-grey-500" : "text-ink-900",
              )}>
                {fig(cash(f?.today))}
              </p>
              <dl className="col-span-2 mt-2 grid grid-cols-2 gap-x-4 sm:col-span-1 sm:mt-0 sm:grid-cols-1 sm:border-t sm:border-grey-100 sm:pt-1.5">
                {([["Month so far", f?.ptd], ["Year so far", f?.ytd]] as const).map(([name, v]) => (
                  <div key={name} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3 sm:leading-[22px]">
                    <dt className="text-xs sm:text-sm text-grey-500">{name}</dt>
                    <dd className={cn("text-sm font-medium tabular", v == null ? "text-grey-500" : "text-grey-700")}>
                      {loading ? <Skeleton className="h-4 w-16 inline-block" /> : cash(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        {/* ── Money ────────────────────────────────────────────────── */}
        <Card className="col-span-12">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle title="Money" info={NOTES.money} />
            <div className="grid max-sm:divide-y max-sm:divide-grey-100 sm:grid-cols-2 sm:grid-rows-[repeat(6,auto)] xl:grid-cols-4 xl:grid-rows-[repeat(3,auto)]">
              <MoneyItem
                icon={Wallet} tone="green" label="Collected today" loading={loading}
                value={cash(payToday?.today)}
                note={methods.length ? methods.map((m) => `${m.label} ${money(m.today)}`) : ["Nothing taken yet today"]}
              />
              <MoneyItem
                icon={ReceiptText} tone={(owedByGuests?.today ?? 0) > 0 ? "orange" : "neutral"}
                label="Owed by guests, less refunds" term="guestLedger" loading={loading}
                value={cash(owedByGuests?.today)} note={["Every guest bill still open"]}
              />
              <MoneyItem
                icon={Building2} label="City ledger" term="cityLedger" loading={loading}
                value={cash(cityLedger?.today)} note={["Shows a dash until company payments are recorded."]}
              />
              <MoneyItem
                icon={UserX} tone={(noShow?.today ?? 0) > 0 ? "orange" : "neutral"}
                label="No-shows" loading={loading} warn={(noShow?.today ?? 0) > 0}
                value={count(noShow?.today)} note={[`Month so far ${count(noShow?.ptd)}`]}
                to="/reports/no-show"
              />
            </div>
          </CardBody>
        </Card>

        {/* ── Today's run: the day's jobs, from today's own bookings ─── */}
        <section
          aria-label="Today's run"
          className="col-span-12 rounded-lg bg-brand-orange-50 border border-brand-orange-100 px-4 py-3.5 sm:px-[18px] sm:py-4"
        >
          <div className="flex items-center justify-between gap-3 mb-3 sm:mb-2">
            <h2 className="text-md font-semibold text-ink-900">Today's run</h2>
            {toGo == null ? null : toGo > 0 ? (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-brand-orange-600 text-white text-xs font-semibold tabular">
                {toGo} to go
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-success-50 ring-1 ring-inset ring-success-100 text-success-600 text-xs font-semibold">
                <Check className="size-3.5" aria-hidden /> Done
              </span>
            )}
          </div>
          <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 items-center sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-6">
            <Rings
              seenKey="fidato.dashboard.rings"
              size="size-28 sm:size-24"
              arcs={(run ?? []).map((x) => ({ value: x.of ? x.done / x.of : 0, color: x.color, track: x.track }))}
            />
            <dl className="grid divide-y divide-brand-orange-100 sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
              {(run ?? [{ key: "in", label: "Check-ins" }, { key: "out", label: "Check-outs" }, { key: "ready", label: "Rooms ready" }]
              ).map((x) => {
                const done = "done" in x ? x.done : null;
                const of = "of" in x ? x.of : null;
                const complete = done != null && of != null && of > 0 && done === of;
                return (
                  <div key={x.key} className="flex items-center justify-between gap-2 min-h-10 sm:flex-col sm:items-start sm:justify-center sm:gap-1 sm:px-6 sm:first:pl-0">
                    <dt className="inline-flex items-center gap-2 text-sm text-grey-700">
                      <i className={cn("size-2 rounded-full", "dot" in x ? x.dot : "bg-grey-300")} aria-hidden />
                      {x.label}
                    </dt>
                    <dd className={cn("text-md sm:text-xl font-semibold tabular", complete ? "text-success-600 inline-flex items-center gap-1" : "text-ink-900")}>
                      {complete && <Check className="size-3.5 sm:size-4" aria-hidden />}
                      {done == null ? <span className="text-grey-500">{DASH}</span> : (
                        <span>{done}<span className="text-grey-500 font-medium">/{of}</span></span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* ── The house, now: one square per room, then the six counts ── */}
        <Card className="col-span-12">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle
              title="The house now"
              info={NOTES.house}
              meta={rooms.length ? `${rooms.length} rooms` : undefined}
            />
            {rooms.length > 0 && <RoomStrip rooms={rooms} />}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 mt-3.5">
              <CountTile icon={LogIn} chip="orange" label="Arrivals" n={c?.["Arrivals"]} loading={loading}
                         job="orange" to={`/h/${code}/arrivals`} />
              <CountTile icon={Users} chip="blue" label="In house" n={c?.["Occupied"]} loading={loading}
                         to={`/h/${code}/in-house`} />
              <CountTile icon={LogOut} chip="yellow" label="Due out" n={c?.["Due Out"]} loading={loading}
                         job="yellow" to={`/h/${code}/in-house/due-out`} />
              <CountTile icon={DoorOpen} label="Empty" n={c?.["Vacant"]} loading={loading}
                         to={`/h/${code}/stay`} />
              {/* Warm only when there is something to do about it; a zero
                  here is good news, so it is green with a check. */}
              <CountTile icon={SprayCan} chip="green" label="Needs cleaning" n={c?.["Dirty"]} loading={loading}
                         warn goodAtZero to={`/h/${code}/housekeeping`} />
              <CountTile icon={Wrench} label="Out of service" n={c?.["Blocked"]} loading={loading}
                         warn to={`/h/${code}/stay`} />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Quick reports ────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-md font-semibold text-ink-900 mr-1 max-sm:w-full">Quick reports</h2>
        {QUICK_REPORTS.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="press inline-flex items-center gap-2 h-[34px] pointer-coarse:min-h-11 px-3.5 rounded-full
                       border border-grey-300 bg-white text-sm font-medium text-grey-700
                       hover:border-grey-400 hover:bg-grey-50
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <q.icon className="size-4 text-grey-500" aria-hidden />
            {q.label}
          </Link>
        ))}
      </div>

      {/* ── Every hotel, for somebody who reads more than one ───── */}
      {hotels.length > 1 && <div className="mt-5"><EveryHotel /></div>}
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

function CardTitle({ title, info, meta }: { title: string; info: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-md font-semibold text-ink-900">{title}</h2>
      <span className="ml-auto flex items-center gap-2">
        {meta && <span className="text-xs text-grey-500 tabular">{meta}</span>}
        <InfoButton className="-mr-1.5">{info}</InfoButton>
      </span>
    </div>
  );
}

/** The Occupancy gauges: the kit's, fed the month and the year. */
function Gauge({ label, value, loading }: { label: string; value: number | null | undefined; loading: boolean }) {
  return (
    <AnchorGauge
      label={label}
      value={loading ? <Skeleton className="h-4 w-14 inline-block bg-white/15" /> : pct(value)}
      missing={value == null && !loading}
      fraction={value == null ? 0 : value / 100}
    />
  );
}

/* ── Money: four levelled columns on a desktop, rows on a phone ──── */

function MoneyItem({ icon: Icon, tone = "neutral", label, term, value, note, loading, warn, to }: {
  icon: LucideIcon; tone?: "neutral" | "orange" | "green";
  label: string; term?: TermKey; value: string; note: string[]; loading: boolean;
  warn?: boolean; to?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2.5 max-sm:contents">
        <IconChip tone={tone} className="max-sm:row-span-2 max-sm:self-center"><Icon /></IconChip>
        <span className="inline-flex items-center gap-1 text-sm font-medium leading-5 text-grey-600 max-sm:col-span-2 max-sm:self-end">
          {term && !to ? <Term name={term}>{label}</Term> : label}
          {/* It opens its report: an arrow says so (the Tappable Rule). */}
          {to && <ChevronRight className="size-4 text-grey-400" aria-hidden />}
        </span>
      </span>
      <span className={cn(
        "text-xl sm:text-2xl leading-[30px] font-semibold tabular tracking-[-0.02em] sm:self-end",
        "max-sm:col-start-3 max-sm:row-start-2 max-sm:text-right",
        value === DASH && !loading ? "text-grey-500" : warn ? "text-brand-orange-700" : "text-ink-900",
      )}>
        {loading ? <Skeleton className="h-7 w-24 inline-block" /> : value}
      </span>
      <span className="text-xs leading-[17px] text-grey-500 max-sm:col-start-2 max-sm:row-start-2 max-sm:self-start">
        {note.map((line) => <span key={line} className="block">{line}</span>)}
      </span>
    </>
  );
  const cls = cn(
    "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3.5 gap-y-0.5 py-3 max-sm:first:pt-0 max-sm:last:pb-0",
    "sm:row-span-3 sm:grid-cols-1 sm:grid-rows-subgrid sm:gap-y-1.5 sm:py-0",
    "sm:[&:nth-child(-n+2)]:pb-4 xl:[&:nth-child(-n+2)]:pb-0",
    "sm:even:pl-4 sm:even:border-l sm:even:border-grey-100",
    "xl:px-4 xl:first:pl-0 xl:last:pr-0 xl:border-l xl:first:border-l-0 xl:border-grey-100",
  );
  if (!to) return <div className={cls}>{body}</div>;
  return (
    <Link
      to={to}
      className={cn(cls, "rounded-md hover:bg-grey-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange")}
    >
      {body}
    </Link>
  );
}

/* ── The strip: one square per room, in the Rooms board's colours ─── */

type StripState = "in" | "due" | "arr" | "free" | "oos";
const STRIP: Record<StripState, { label: string; cls: string; key: string }> = {
  in: { label: "In house", cls: "bg-info text-white", key: "bg-info" },
  due: { label: "Due out", cls: "bg-brand-yellow text-ink-900", key: "bg-brand-yellow" },
  /* orange-600, not the brand orange: white 12px numbers on #df6128 are
     3.57:1 (the Readable Step Rule). */
  arr: { label: "Arriving", cls: "bg-brand-orange-600 text-white", key: "bg-brand-orange-600" },
  free: { label: "Free", cls: "bg-grey-50 text-grey-500 ring-1 ring-inset ring-grey-200", key: "bg-grey-50 ring-1 ring-inset ring-grey-200" },
  oos: { label: "Out of service", cls: "bg-grey-200 text-grey-600", key: "bg-grey-200" },
};

function stateOf(room: ChartRoom): StripState {
  if (room.outOfService) return "oos";
  if (room.state.occupied) return room.state.dueOut ? "due" : "in";
  if (room.state.arriving) return "arr";
  return "free";
}

function RoomStrip({ rooms }: { rooms: ChartRoom[] }) {
  const across = Math.min(rooms.length, 18);
  return (
    <>
      <ul
        className="grid grid-cols-6 sm:grid-cols-9 xl:grid-cols-[repeat(var(--across),minmax(0,1fr))] gap-1"
        style={{ "--across": across } as CSSProperties}
        aria-label="Every room, by its state now"
      >
        {rooms.map((room) => {
          const s = stateOf(room);
          return (
            <li
              key={room.number}
              aria-label={`${room.number}, ${STRIP[s].label}`}
              className={cn("h-7 rounded-[6px] grid place-items-center text-xs font-semibold tabular", STRIP[s].cls)}
            >
              {room.number}
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2 text-xs text-grey-500" aria-hidden>
        {(Object.keys(STRIP) as StripState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className={cn("size-2 rounded-[2px]", STRIP[s].key)} />
            {STRIP[s].label}
          </span>
        ))}
      </p>
    </>
  );
}

/* ── A count that opens its list ───────────────────────────────────
   The label comes first in the markup and sits under the count on the
   screen: a link reads "In house 2", its words then its figure. */

function CountTile({ icon: Icon, chip = "neutral", label, n, loading, to, job, warn, goodAtZero }: {
  icon: LucideIcon; chip?: "neutral" | "orange" | "yellow" | "blue" | "green";
  label: string; n: number | undefined; loading: boolean; to: string;
  /** Today's job: a warm tile while there is some of it to do. */
  job?: "orange" | "yellow";
  /** Orange above zero (the Signal Rule). */
  warn?: boolean;
  /** Zero is good news: green, with a check. */
  goodAtZero?: boolean;
}) {
  const value = loading ? undefined : n;
  const busy = (value ?? 0) > 0;
  return (
    <Link
      to={to}
      className={cn(
        "press-tile grid grid-rows-[auto_auto] gap-y-1.5 rounded-[10px] px-3.5 py-3 sm:p-2.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
        job && busy
          ? job === "orange"
            ? "bg-brand-orange-50 ring-1 ring-inset ring-brand-orange-100"
            : "bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100"
          : "hover:bg-grey-50",
      )}
    >
      <span className="row-start-2 text-sm leading-[18px] text-grey-600 whitespace-nowrap">{label}</span>
      <span className="row-start-1 flex items-center gap-2">
        <IconChip size={24} tone={chip === "green" && busy ? "neutral" : chip}><Icon /></IconChip>
        <b className={cn(
          "inline-flex items-center gap-1 text-xl leading-[26px] font-semibold tabular tracking-[-0.02em]",
          value == null ? "text-grey-500"
            : warn && busy ? "text-brand-orange-700"
              : goodAtZero && value === 0 ? "text-success-600" : "text-ink-900",
        )}>
          {count(value)}
          {goodAtZero && value === 0 && <Check className="size-4" aria-hidden />}
        </b>
        {/* Each count opens its list (the Tappable Rule). */}
        <ChevronRight className="ml-auto size-4 text-grey-400 shrink-0" aria-hidden />
      </span>
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
