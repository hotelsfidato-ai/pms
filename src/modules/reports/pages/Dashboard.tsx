import { useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Rectangle, usePlotArea,
  type BarShapeProps,
} from "recharts";
import {
  Check, ChevronRight, BedDouble, IndianRupee, TrendingUp, Banknote,
  LogIn, LogOut, Users, SprayCan, Wallet, ReceiptText,
  Building2, UserX, ClipboardList, ChartColumn, Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, percent, dateShort, dateCompact, dateLong, addDays } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole, useSession } from "@/lib/session";
import { hotelLabel } from "@/lib/testHotel";
import { can } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, Skeleton, NativeSelect, Term, EmptyState, Button,
  InfoButton, IconChip, Rings, AnchorGauge, ReadFailed, readError,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { SetupStillToDo } from "@/modules/admin";
import type { TermKey } from "@/lib/glossary";
import { BUSINESS_DATE } from "@/data/repositories";
import { getStayView, fetchStays, isCancelledOrVoid, type ChartRoom } from "@/modules/front-desk";
import type { DayStatistics } from "@/data/repositories";
import { listDailyStatistics, monthOf } from "@/modules/reports/data/statistics";
import { getReport, type ReportDoc } from "@/modules/reports/data/document";
import { getDueOut } from "@/modules/reports/data/dueOut";

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
   Money, the house as a strip of rooms, then the quick reports. The
   section notes moved behind an (i), same words.

   2 OCTOBER, AS SKETCHED (the owner's D27-243): TODAY'S WORK LEADS, four
   tiles that open their lists (Arrivals, Due out with what departing
   guests still owe, In house, Needs cleaning), coloured by what staff
   must do: orange act now, yellow due today, green done, white nothing to
   do. They replace Today's run and the six small counts. "ARR" on the
   screen; the nights ahead under the figures; Occupancy on its own row
   under 1440 px (REP-16). Every property moved to All properties.
   Everything counted is what the system holds: today's bookings, the
   Rooms board's room states, the daily statistics, finance's balances.
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
  house: "Every room on the business date, in the Rooms board's colours.",
  money: "From the same figures as the Manager Report. A dash is a figure this system does not hold yet, never a zero.",
  nights: "Tonight and the 13 nights after it: rooms sold, as a share of the rooms to sell, as the Calendar's footer shows them. A night with no figures shows a dash. Each opens the Calendar.",
  /* The charts (the owner's D27-365): the words as rendered and approved. */
  days: "Each night of the month, from the same figures as the Monthly statistics report. Nights after the business date show what is booked so far.",
  revenue: "From the Manager report's Revenue Summary, without tax.",
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
  /* No property at all (a fresh system, D27-248): no code, even one this
     device remembers from before - nothing is asked for a hotel that is gone. */
  const code = hotels.length ? picked ?? uiCode ?? hotels[0]?.code ?? "" : "";
  const hotel = hotels.find((h) => h.code === code);
  /* That hotel's OWN operating day — two properties are routinely on
     different dates, one audited and one not. */
  const date = hotel?.businessDate || BUSINESS_DATE
    /* No property at all - a fresh system (D27-248): any real day, so the
       date arithmetic below cannot throw; the page says to add one. */
    || new Date().toISOString().slice(0, 10);

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
  /* Today's arrivals and departures, from the board's read of the day
     (D27-316 (1)): not every booking ever made. */
  const stays = useQuery({
    queryKey: ["dashboard-stays", code, date],
    queryFn: () => fetchStays(code, date, date, true),
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
  /* Company payments are recorded since 189 (the cash lane, D27-239). */
  const companyPaid = pick(r, "city-ledger", "Payment Received");
  const c = view.data?.counts;
  const rooms = (view.data?.roomTypes ?? []).flatMap((t) => t.rooms)
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const loading = report.isLoading || view.isLoading;
  /* A read that failed prints dashes too, and a dash here means "a figure
     this system does not hold yet" — so a failure has to say so, or the
     page tells the owner the business has no figures. */
  const failed = readError(report) ?? readError(view) ?? readError(stays);

  /* What departing guests still owe: asked only by whoever sees money
     (the menu's and the server's `invoice`, D27-147). */
  const seesMoney = can(useRole(), "view", "invoice");
  const due = useQuery({
    queryKey: ["dashboard-due-out", code, date],
    queryFn: () => getDueOut(code),
    enabled: Boolean(code) && seesMoney,
  });
  const nightsTo = addDays(date, 13);
  const nights = useQuery({
    queryKey: ["dashboard-nights", code, date],
    queryFn: () => listDailyStatistics(code, date, nightsTo),
    enabled: Boolean(code),
  });

  /* THE CHARTS' ONE MORE READ (D27-365): the Monthly statistics report for
     the business date's month - the chart's nights and the "Last 14 days"
     lines. While those 14 days cross a month start, the month before as well. */
  const month = date.slice(0, 7);
  const before = addDays(date, -(LAST_DAYS - 1)) < monthStart(date) ? addDays(monthStart(date), -1).slice(0, 7) : null;
  const thisMonth = useQuery({
    queryKey: ["dashboard-month", code, month],
    queryFn: () => getReport(code, "monthly-statistics", { month }),
    enabled: Boolean(code),
  });
  const lastMonth = useQuery({
    queryKey: ["dashboard-month", code, before],
    queryFn: () => getReport(code, "monthly-statistics", { month: before! }),
    enabled: Boolean(code) && before != null,
  });
  const monthRows = monthDays(thisMonth.data, month);
  const lastRows = lastDays([...monthDays(lastMonth.data, before ?? ""), ...monthRows], date);
  const sparking = thisMonth.isLoading || lastMonth.isLoading;

  /* TODAY'S WORK — only counts the system holds (the owner's yes, 27
     September, kept in D27-243). Arrivals: today's, of which still to come
     (no-shows and cancellations are not work). Due out: today's
     departures, of which still here. In house and Needs cleaning: the
     Rooms board's own counts. */
  const today = (() => {
    if (!stays.data || !view.data) return null;
    const all = stays.data;
    /* Void with cancelled (the owner's D27-326 (1)): front desk's one rule. */
    const arriving = all.filter((s) => s.arrival === date && !isCancelledOrVoid(s) && s.status !== "no-show");
    const leaving = all.filter((s) => s.departure === date
      && (s.status === "in-house" || s.status === "due-out" || s.status === "checked-out"));
    const empty = rooms.filter((x) => !x.outOfService && !x.state.occupied);
    return {
      arriving: arriving.length,
      toArrive: arriving.filter((s) => s.status === "due-in").length,
      leaving: leaving.length,
      toLeave: leaving.filter((s) => s.status !== "checked-out").length,
      empty: empty.length,
      ready: empty.filter((x) => !x.state.dirty).length,
    };
  })();
  const owing = seesMoney ? due.data ?? null : null;

  if (!code) {
    return (
      <Page>
        <PageHeader title="Dashboard" />
        <Card><EmptyState
          icon={<Building2 />}
          title="No property yet"
          description="Add your first property; its day's work and figures appear here."
          action={<Button asChild variant="primary"><Link to="/admin/properties">Add a property</Link></Button>}
        /></Card>
      </Page>
    );
  }

  const figures: Array<{ icon: LucideIcon; label: string; term?: TermKey; f?: Figure; line: LineKey }> = [
    /* "ARR" on the screen (the owner's D27-243); the printed Manager report
       keeps its "Average Daily Rate (ADR)", which `pick` reads above. */
    { icon: IndianRupee, label: "Average rate (ARR)", term: "adr", f: adr, line: "adr" },
    { icon: TrendingUp, label: "RevPAR", term: "revpar", f: revpar, line: "revpar" },
    { icon: Banknote, label: "Room revenue", f: roomRev, line: "room" },
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
              {/* A test hotel with TEST beside its name (D27-296 (9)). */}
              {hotels.map((h) => (
                <option key={h.code} value={h.code}>{hotelLabel(h)}</option>
              ))}
            </NativeSelect>
          </label>
        ) : undefined}
      />

      <StartHere className="mb-5" />
      {/* D27-311: the setup steps put off, for the owner, an Admin and the GM; nothing while none waits. */}
      <SetupStillToDo code={code} className="mb-5" />

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
        {/* ── Today's work: four tiles that open their lists ───────── */}
        <section
          aria-label="Today's work"
          className="col-span-12 grid grid-cols-2 grid-rows-[repeat(6,auto)] gap-x-3 gap-y-3 xl:grid-cols-4 xl:grid-rows-[auto_auto_auto] xl:gap-y-0"
        >
          <WorkTile
            icon={LogIn} chip="yellow" label="Arrivals" to={`/h/${code}/arrivals`} loading={loading}
            count={today?.arriving} left={today?.toArrive}
            state={!today ? "none" : today.arriving === 0 ? "none" : today.toArrive > 0 ? "due" : "done"}
            note={!today ? [] : today.arriving === 0 ? ["None today"]
              : today.toArrive > 0
                ? [<b key="b">{today.toArrive} still to arrive</b>, `${today.arriving - today.toArrive} checked in`]
                : [`All ${today.arriving} checked in`]}
          />
          <WorkTile
            icon={LogOut} chip="orange" label="Due out" to={`/h/${code}/in-house/due-out`} loading={loading}
            count={today?.leaving} left={today?.toLeave}
            state={!today ? "none" : today.leaving === 0 ? "none"
              : today.toLeave === 0 ? "done" : (owing?.owing ?? 0) > 0 ? "now" : "due"}
            note={!today ? [] : today.leaving === 0 ? ["None today"]
              : today.toLeave === 0 ? [`All ${today.leaving} checked out`]
                : [
                  owing && owing.owing > 0
                    ? <b key="b">{owing.owing} owe {money(owing.owed)}</b>
                    : <b key="b">{today.toLeave} still to leave</b>,
                  `${today.leaving - today.toLeave} checked out`,
                ]}
          />
          <WorkTile
            icon={Users} chip="blue" label="In house" to={`/h/${code}/in-house`} loading={loading}
            count={c?.["Occupied"]} state="none"
            note={c ? [`${(c["Occupied"] ?? 0) - (c["Due Out"] ?? 0)} staying on`, `${c["Due Out"] ?? 0} leave today`] : []}
          />
          <WorkTile
            icon={SprayCan} chip="green" label="Needs cleaning" to={`/h/${code}/housekeeping`} loading={loading}
            count={c?.["Dirty"]} state={c?.["Dirty"] == null ? "none" : c["Dirty"] > 0 ? "due" : "done"}
            note={today ? ["Free rooms ready", `${today.ready} of ${today.empty}`] : []}
          />
        </section>

        {/* ── The anchor: Occupancy, in navy. Its own row under 1440 px
            (REP-16): beside the figures, "Month so far" broke beside its
            amount between 1280 and 1439. ─────────────────────────────── */}
        <div className="col-span-12 min-[1440px]:col-span-5 flex flex-col gap-3 rounded-lg bg-ink-900 text-white px-4 py-3.5 sm:px-[18px] sm:py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-white/72">
            <IconChip tone="glass"><BedDouble /></IconChip>
            <Term name="occupancy" className="decoration-white/35">Occupancy</Term>
            <InfoButton className="ml-auto text-white/60 hover:bg-white/10 hover:text-white">{NOTES.today}</InfoButton>
          </div>
          <div className="flex-1 grid gap-4 sm:gap-6 items-center sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="grid grid-cols-[80px_auto] gap-4 items-center">
              <Rings seenKey="fidato.dashboard.rings" size="size-20" arcs={[{ value: occ?.today == null ? null : occ.today / 100, color: "var(--color-brand-orange)", track: "rgb(255 255 255 / 0.12)" }]} />
              <div>
                {/* A <div>: while loading it holds the Skeleton, a <div> too. */}
                <div className={cn("text-3xl font-semibold tabular tracking-[-0.03em]", occ?.today == null && !loading && "text-white/55")}>
                  {fig(pct(occ?.today), "w-28 bg-white/15")}
                </div>
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
        <div className="col-span-12 min-[1440px]:col-span-7 grid gap-3 sm:grid-cols-3 sm:grid-rows-[auto_auto_auto]
                        max-sm:gap-0 max-sm:bg-white max-sm:border max-sm:border-grey-200 max-sm:rounded-lg max-sm:divide-y max-sm:divide-grey-200">
          {figures.map(({ icon: Icon, label, term, f, line }) => (
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
              <div className={cn(
                "text-xl sm:text-2xl leading-[30px] font-semibold tabular tracking-[-0.022em] text-right sm:text-left",
                f?.today == null && !loading ? "text-grey-500" : "text-ink-900",
              )}>
                {fig(cash(f?.today))}
              </div>
              <dl className="col-span-2 mt-2 grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 sm:col-span-1 sm:mt-0 sm:grid-cols-1 sm:border-t sm:border-grey-100 sm:pt-1.5">
                {/* THE SMALL LINE (D27-365): a row like the others, its line where a value would be. */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:leading-[22px]">
                  <dt className="text-xs sm:text-sm text-grey-500 whitespace-nowrap">Last 14 days</dt>
                  <dd><Spark name={label.replace(/ \(.*/, "")} days={lastRows} line={line} loading={sparking} /></dd>
                </div>
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

        {/* ── The charts (D27-217 to D27-219, D27-365): the month, night by
            night, beside where its revenue came from. 8 + 4 columns from
            1440 px, 7 + 5 from 1280, one under the other below that. ───── */}
        <Card className="col-span-12 min-[1280px]:col-span-7 min-[1440px]:col-span-8 flex flex-col">
          <CardBody className="flex flex-1 flex-col sm:px-[18px] sm:py-4">
            <CardTitle title="Occupancy by day" info={NOTES.days} meta={`${monthOf(date).name} ${monthOf(date).year}`} />
            {thisMonth.isError ? (
              <ReadFailed compact error={readError(thisMonth)!} what="the month's occupancy" onRetry={() => void thisMonth.refetch()} />
            ) : (
              <OccupancyByDay days={monthRows} date={date} loading={thisMonth.isLoading} monthName={`${monthOf(date).name} ${monthOf(date).year}`} />
            )}
          </CardBody>
        </Card>
        <Card className="col-span-12 min-[1280px]:col-span-5 min-[1440px]:col-span-4">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle title="Revenue" info={NOTES.revenue} meta="Without tax" />
            <RevenueSplit doc={r} loading={report.isLoading} />
          </CardBody>
        </Card>

        {/* ── The nights ahead: a bar under each date (D27-243) ───────── */}
        <Card className="col-span-12">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle title="Nights ahead" info={NOTES.nights}
              meta={`${dateShort(date)} to ${dateShort(nightsTo)}`} />
            {nights.isError ? (
              <ReadFailed compact error={readError(nights)!} what="the nights ahead" onRetry={() => void nights.refetch()} />
            ) : (
              <NightsAhead from={date} days={nights.data} loading={nights.isLoading} to={`/h/${code}/calendar`} />
            )}
          </CardBody>
        </Card>

        {/* ── Money ────────────────────────────────────────────────── */}
        <Card className="col-span-12">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle title="Money" info={NOTES.money} />
            <div className="grid max-sm:divide-y max-sm:divide-grey-100 sm:grid-cols-2 sm:grid-rows-[repeat(6,auto)] xl:grid-cols-4 xl:grid-rows-[repeat(3,auto)]">
              <MoneyItem
                icon={Wallet} tone="green" label="Collected today" loading={loading}
                value={cash(payToday?.today)}
                note={methods.length
                  ? methods.map((m, i) => (
                    <span key={m.label} className="flex items-center gap-1.5"><Swatch i={i} />{m.label} {money(m.today)}</span>
                  ))
                  : ["Nothing taken yet today"]}
                /* CHART 4 (D27-365): how it was paid, as a split bar under the methods. */
                bar={methods.length > 0 && !loading
                  ? <SplitBar parts={methods.map((m) => ({ name: m.label, value: m.today }))} /> : undefined}
              />
              <MoneyItem
                icon={ReceiptText} tone={(owedByGuests?.today ?? 0) > 0 ? "orange" : "neutral"}
                label="Owed by guests, less refunds" term="guestLedger" loading={loading}
                value={cash(owedByGuests?.today)} note={["Every guest bill still open"]}
              />
              <MoneyItem
                icon={Building2} label="City ledger" term="cityLedger" loading={loading}
                value={cash(cityLedger?.today)} note={[`Paid today ${cash(companyPaid?.today)}`]}
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

        {/* ── The house, now: one square per room. Its six small counts
            moved up into Today's work (D27-243). ─────────────────────── */}
        <Card className="col-span-12">
          <CardBody className="sm:px-[18px] sm:py-4">
            <CardTitle
              title="The house now"
              info={NOTES.house}
              meta={c ? `${rooms.length} rooms · ${c["Vacant"] ?? 0} empty · ${c["Blocked"] ?? 0} out of service` : undefined}
            />
            {rooms.length > 0 && <RoomStrip rooms={rooms} />}
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
    /* On a phone the note goes under the heading, so the heading stays on
       one line (the Breathing Room Rule); beside it from 640 px. */
    <div className="flex flex-wrap items-center gap-x-2 mb-3">
      <h2 className="text-md font-semibold text-ink-900">{title}</h2>
      <InfoButton className="-mr-1.5 ml-auto sm:ml-0 sm:order-3">{info}</InfoButton>
      {meta && <span className="basis-full sm:basis-auto sm:ml-auto sm:order-2 text-xs text-grey-500 tabular">{meta}</span>}
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

function MoneyItem({ icon: Icon, tone = "neutral", label, term, value, note, bar, loading, warn, to }: {
  icon: LucideIcon; tone?: "neutral" | "orange" | "green";
  label: string; term?: TermKey; value: string; note: ReactNode[]; loading: boolean;
  /** A split bar under the note: inside it on a desktop (the third line of the
      levelled columns), a row of its own on a phone. */
  bar?: ReactNode;
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
        {note.map((line, i) => <span key={i} className="block">{line}</span>)}
        {bar && <span className="mt-2 block max-sm:hidden">{bar}</span>}
      </span>
      {bar && <span className="sm:hidden col-span-2 col-start-2 mt-1.5">{bar}</span>}
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

/* ── Today's work: a tile that opens its list ──────────────────────
   Stayntouch's big counts, coloured by what staff must do (Mews; the
   owner's D27-243): orange act now, yellow due today, green done, white
   nothing to do. The label comes first in the markup, so a link reads
   "Due out 4 · 3 left …", its words then its figures. Three lines,
   levelled across the row by subgrid; on a phone the note takes two. */

type TileState = "now" | "due" | "done" | "none";

const TILE: Record<TileState, string> = {
  now: "bg-brand-orange-50 ring-brand-orange-100 hover:ring-brand-orange-700",
  due: "bg-brand-yellow-50 ring-brand-yellow-100 hover:ring-brand-yellow-800",
  done: "bg-white ring-grey-200 hover:ring-grey-400",
  none: "bg-white ring-grey-200 hover:ring-grey-400",
};
const TILE_NOTE: Record<TileState, string> = {
  now: "[&_b]:text-brand-orange-700",
  due: "[&_b]:text-brand-yellow-800",
  done: "",
  none: "",
};

function WorkTile({ icon: Icon, chip, label, to, count: n, left, state, note, loading }: {
  icon: LucideIcon; chip: "orange" | "yellow" | "blue" | "green";
  label: string; to: string;
  /** Today's total; null while it is not known (a dash). */
  count: number | null | undefined;
  /** Of which still to do, shown "· n left" while some is. */
  left?: number | null | undefined;
  state: TileState; note: ReactNode[]; loading: boolean;
}) {
  const done = state === "done" && n === 0;
  return (
    <Link
      to={to}
      data-state={state}
      className={cn(
        "press-tile relative row-span-3 grid grid-rows-subgrid gap-y-1.5 rounded-lg ring-1 ring-inset px-3.5 py-3 sm:px-[18px] sm:py-4",
        "transition-[box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
        TILE[state],
      )}
    >
      <span className="sm:relative flex items-center gap-2 sm:gap-2.5 sm:pr-5 text-sm font-medium leading-5 text-grey-600 whitespace-nowrap">
        <IconChip tone={chip} className="max-sm:size-6 max-sm:rounded-[7px] max-sm:[&>svg]:size-3.5"><Icon /></IconChip>
        {label}
        {/* It opens its list: an arrow says so (the Tappable Rule). On a phone
            it sits at the tile's right edge, so "Needs cleaning" fits. */}
        <ChevronRight className="absolute right-0 size-4 text-grey-500 max-sm:right-3 max-sm:top-1/2 max-sm:-translate-y-1/2" aria-hidden />
      </span>
      <span className={cn(
        "flex items-baseline gap-2 text-xl sm:text-2xl leading-[26px] sm:leading-[30px] font-semibold tabular tracking-[-0.02em]",
        n == null ? "text-grey-500" : done || state === "done" ? "text-success-600" : "text-ink-900",
      )}>
        {loading ? <Skeleton className="h-6 w-12 inline-block" /> : count(n)}
        {state === "done" && !loading && <Check className="size-4 self-center" aria-hidden />}
        {!loading && left != null && left > 0 && (
          <span className="text-sm font-medium tracking-normal text-grey-600">· {left} left</span>
        )}
      </span>
      <span className={cn("text-xs font-medium leading-[17px] text-grey-600 whitespace-nowrap", TILE_NOTE[state])}>
        {note.map((part, i) => (
          <span key={i} className={cn(i > 0 && "max-sm:block sm:before:content-['_·_']")}>{part}</span>
        ))}
      </span>
    </Link>
  );
}

/* ── The nights ahead (eZee's bar under each date; the owner's D27-243)
   Tonight and the 13 nights after it, from the daily statistics the
   Calendar's footer shows: rooms sold of the rooms to sell, a capsule bar,
   the share as the footer rounds it. A night the statistics do not hold
   is a dash, never 0%. Tonight in navy; weekends washed, as the Calendar
   draws them. On a phone the row scrolls inside its card. */

function NightsAhead({ from, days, loading, to }: {
  from: string; days: DayStatistics[] | undefined; loading: boolean; to: string;
}) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const nights = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  return (
    <ul
      aria-label="Nights ahead: rooms sold"
      className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1
                 max-sm:grid-cols-none max-sm:grid-flow-col max-sm:auto-cols-[60px] max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory
                 max-sm:[mask-image:linear-gradient(90deg,#000_85%,transparent)]"
    >
      {nights.map((date, i) => {
        const d = byDate.get(date);
        const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
        const weekend = weekday === "Sat" || weekday === "Sun";
        const tonight = i === 0;
        const share = d && d.availableRooms > 0 ? Math.round(d.occupancyPct) : null;
        return (
          <li key={date} className="snap-start">
            <Link
              to={to}
              aria-label={`${tonight ? "Tonight" : weekday} ${dateShort(date)}: ${d ? `${d.roomsSold} of ${d.availableRooms} rooms sold` : "no figures"}`}
              className={cn(
                "grid gap-1 rounded-[8px] px-1.5 py-2 text-center tabular",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                tonight ? "bg-ink-900 text-white" : weekend ? "bg-grey-50 text-ink-900 hover:bg-grey-100" : "text-ink-900 hover:bg-grey-50",
              )}
            >
              <span className={cn("text-xs leading-[17px]", tonight ? "text-white/72" : "text-grey-500")}>{tonight ? "Tonight" : weekday}</span>
              <span className="text-sm font-semibold leading-5">{Number(date.slice(8, 10))}</span>
              <span className={cn("mx-1 my-0.5 h-1 rounded-full overflow-hidden", tonight ? "bg-white/16" : "bg-grey-100")} aria-hidden>
                <i className={cn("block h-full rounded-full", tonight ? "bg-white" : "bg-info")} style={{ width: `${share ?? 0}%` }} />
              </span>
              <span className={cn("text-xs leading-[17px] font-semibold", share == null && (tonight ? "text-white/72" : "text-grey-500"))}>
                {loading ? <Skeleton className="h-3 w-8 inline-block" /> : share == null ? DASH : `${share}%`}
              </span>
              <span className={cn("text-xs leading-[17px]", tonight ? "text-white/72" : "text-grey-500")}>
                {d ? `${d.roomsSold}/${d.availableRooms}` : DASH}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ══════════════════════════════════════════════════════════════════
   THE CHARTS (the owner's D27-217 to D27-219 and D27-365, 26 October)

   Four small drawings, none of them animated, none inventing a figure:

     1. Occupancy by day: the month, night by night (Recharts, the one
        chart that needs axes and a reading tooltip). Nights so far in
        the blue of "in house", nights after the business date in the
        same blue at half strength, today's number marked in navy.
     2. "Last 14 days": a line inside each of the three figures.
     3. Revenue: the month so far without tax, split by where it came from.
     4. Collected today: a split bar under the methods Money lists.

   Charts 1 and 2 read the Monthly statistics report; 3 and 4 read the
   Manager report the page has already loaded. The rules are DESIGN.md's
   "Charts": a gap is never a zero, one value is written on the chart
   (today's), the rest are read by hover, tap or the arrow keys.
   ══════════════════════════════════════════════════════════════════ */

/** The days "Last 14 days" covers, today included. */
const LAST_DAYS = 14;

/** The width of the occupancy chart's % axis. */
const AXIS = 44;

type LineKey = "adr" | "revpar" | "room";

/** One day of the Monthly statistics report. A figure the report cannot work
    out for that day is null: a gap, never a zero. */
export interface MonthDay {
  date: string;
  available: number | null;
  /** Percent, 0 to 100. */
  occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  room: number | null;
}

/** The days of a Monthly statistics report, as `MonthDay`s. The report prints
    0 for a rate over no rooms (its `ratio`); this turns those into gaps: no
    room sold has no average rate, and no room to sell has no RevPAR. */
export function monthDays(doc: ReportDoc | null | undefined, month: string): MonthDay[] {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return (doc?.sections.find((s) => s.key === "days")?.rows ?? [])
    .filter((r) => r.kind === "row")
    .map((r) => {
      const c = r.cells;
      const available = num(c["available"]);
      const occupancy = num(c["occupancy"]);
      return {
        /* The row's label is "7 Mon": the day, then its weekday. */
        date: `${month}-${String(parseInt(String(c["label"]), 10)).padStart(2, "0")}`,
        available,
        occupancy,
        adr: occupancy ? num(c["adr"]) : null,
        revpar: available ? num(c["revpar"]) : null,
        room: num(c["room"]),
      };
    });
}

/** The 14 days ending on `date`, in order. A day the reads do not hold is a gap. */
export function lastDays(days: MonthDay[], date: string, n = LAST_DAYS): MonthDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(date, i - (n - 1));
    return byDate.get(d) ?? { date: d, available: null, occupancy: null, adr: null, revpar: null, room: null };
  });
}

/** The Manager report's Revenue Summary (without tax): each part of the
    month's revenue (room, extras, each restaurant) and the total. */
export function revenueSplit(doc: ReportDoc | null | undefined) {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const words: Record<string, string> = { "Room Revenue": "Room revenue", "Extra Revenue": "Extra revenue" };
  const parts = (doc?.sections.find((s) => s.key === "revenue-summary")?.rows ?? [])
    .filter((r) => r.kind === "row")
    .map((r) => {
      const label = String(r.cells["label"]);
      return { name: words[label] ?? label, value: num(r.cells["ptd"]) };
    });
  return { parts, total: pick(doc, "revenue-summary", "Total Revenue") };
}

const weekdayOf = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

/* ── A split bar: ink and greys, so no colour gets a second meaning ──
   The first three parts are ink-900, grey-600 and grey-400 (they pass the
   chart palette check); a fourth and later share grey-300. Each row beside
   the bar names its part, so the bar is never read by colour alone. */

const SPLIT = ["bg-ink-900", "bg-grey-600", "bg-grey-400", "bg-grey-300"];
const splitColour = (i: number) => SPLIT[Math.min(i, SPLIT.length - 1)]!;

function Swatch({ i }: { i: number }) {
  return <i className={cn("size-2 shrink-0 rounded-[2px]", splitColour(i))} aria-hidden />;
}

function SplitBar({ parts, className }: { parts: Array<{ name: string; value: number | null }>; className?: string }) {
  return (
    <div
      role="img"
      aria-label={parts.map((p) => `${p.name} ${p.value == null ? DASH : money(p.value)}`).join(", ")}
      className={cn("flex h-2 gap-0.5 overflow-hidden rounded-full", className)}
    >
      {parts.map((p, i) => (p.value != null && p.value > 0 ? (
        <span
          key={p.name}
          title={`${p.name} ${money(p.value)}`}
          className={cn("block min-w-0.5", splitColour(i))}
          style={{ flex: p.value }}
        />
      ) : null))}
    </div>
  );
}

/* ── Chart 3: Revenue ───────────────────────────────────────────── */

function RevenueSplit({ doc, loading }: { doc: ReportDoc | null | undefined; loading: boolean }) {
  const { parts, total } = revenueSplit(doc);
  const share = (v: number | null) => (v == null || !total?.ptd ? DASH : percent((v / total.ptd) * 100, 2));
  const num = (v: number | null | undefined) => (loading ? <Skeleton className="inline-block h-4 w-16" /> : cash(v));
  return (
    <>
      {/* Leads with the month so far; today is a row under it (the owner, D27-365 (4)). */}
      <div className="flex items-baseline justify-between gap-3">
        <div className={cn(
          "text-2xl leading-[30px] font-semibold tabular tracking-[-0.022em]",
          total?.ptd == null && !loading ? "text-grey-500" : "text-ink-900",
        )}>
          {loading ? <Skeleton className="h-7 w-28" /> : cash(total?.ptd)}
        </div>
        <span className="text-xs leading-[17px] text-grey-500">Month so far</span>
      </div>
      {!loading && parts.length > 0 && (
        <>
          <SplitBar parts={parts} className="my-3" />
          <div className="grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-x-2 text-sm leading-[22px]">
            {parts.map((p, i) => (
              <div key={p.name} className="contents">
                <Swatch i={i} />
                <span className="min-w-0 truncate text-grey-600">{p.name}</span>
                <span className="pl-1 text-right tabular text-grey-500">{share(p.value)}</span>
                <b className={cn("pl-1 text-right font-medium tabular", p.value == null ? "text-grey-500" : "text-grey-700")}>{cash(p.value)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      <dl className="mt-2 border-t border-grey-100 pt-1.5 text-sm leading-[22px]">
        {([["Today", total?.today], ["Year so far", total?.ytd]] as const).map(([name, v]) => (
          <div key={name} className="flex justify-between gap-3">
            <dt className="text-grey-500">{name}</dt>
            <dd className={cn("font-medium tabular", v == null ? "text-grey-500" : "text-grey-700")}>{num(v)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/* ── Chart 2: the small line in each figure ─────────────────────────
   Plain SVG in a 100 x 100 box stretched over its row, so it needs no
   measuring; the end dot is a span at the same percentages. A day with no
   figure breaks the line: it is a gap, and a day on its own is a dot. */

function Spark({ name, days, line, loading }: {
  name: string; days: MonthDay[]; line: LineKey; loading: boolean;
}) {
  const [at, setAt] = useState(-1);
  if (loading) return <Skeleton className="inline-block h-4 w-16" />;
  const n = days.length;
  const values = days.map((d) => d[line]);
  const max = Math.max(...values.map((v) => v ?? 0)) || 1;
  const px = (i: number) => (i * 100) / (n - 1);
  const py = (v: number) => 88 - 76 * (v / max);
  let path = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}${pen ? "" : `L${px(i).toFixed(1)},${py(v).toFixed(1)}`}`;
    pen = true;
  });
  if (!path) return <span className="text-sm text-grey-500">{DASH}</span>;

  const last = values[n - 1];
  const gaps = days.filter((_, i) => values[i] == null).map((d) => dateCompact(d.date));
  const show = (v: number | null | undefined) => (v == null ? DASH : money(v));
  const label = `${name}, last ${n} days: ${show(values[0])} on ${dateCompact(days[0]!.date)}, ${show(last)} today.`
    + (gaps.length ? ` ${line === "adr" ? "No rooms were sold on" : "No figure on"} ${gaps.join(", ")}.` : "");
  const point = at >= 0 ? days[at]! : null;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - 4) / (r.width - 8)) * (n - 1)))));
  };
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-5 w-full touch-pan-y sm:h-[22px] sm:w-24 sm:min-w-12 sm:shrink"
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={() => setAt(-1)}
    >
      <div className="absolute inset-x-1 inset-y-0">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={path} fill="none" stroke="var(--color-grey-400)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {point && values[at] != null && at < n - 1 && (
          <i className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-grey-600 ring-2 ring-white" style={{ left: `${px(at)}%`, top: `${py(values[at]!)}%` }} />
        )}
        {last != null && (
          <i className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-900 ring-2 ring-white" style={{ left: "100%", top: `${py(last)}%` }} />
        )}
      </div>
      {point && (
        <div className="pointer-events-none absolute right-0 bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-xs leading-[17px] text-grey-600 tabular ring-1 ring-grey-200 shadow-popover">
          <b className="block text-sm leading-5 font-semibold text-ink-900">{show(values[at])}</b>
          {weekdayOf(point.date)} {dateCompact(point.date)}{values[at] == null && line === "adr" ? " · no rooms sold" : ""}
        </div>
      )}
    </div>
  );
}

/* ── Chart 1: Occupancy by day ──────────────────────────────────── */

interface Night {
  day: string; date: string; wd: string;
  occ: number | null; rooms: number | null; avail: number | null;
  ahead: boolean; today: boolean; weekend: boolean; last: boolean;
  /** How many nights the chart holds, for the width of a night's band. */
  count: number;
}

/** A bar: its blue, a wash behind a weekend, and, on today's, the one value written on the chart. */
function NightBar(p: BarShapeProps) {
  const n = p.payload as Night;
  const r = Math.min(4, p.width / 2, p.height);
  /* The night's whole band, not the bar's own width: the plot's width over the nights. */
  const plot = usePlotArea();
  const band = plot ? plot.width / n.count : 0;
  return (
    <g>
      {n.weekend && (
        <rect x={p.x + p.width / 2 - band / 2} y={plot?.y ?? 0} width={band} height={plot?.height ?? 0} fill="var(--color-grey-50)" />
      )}
      {n.occ != null && p.height > 0 && (
        <Rectangle
          x={p.x} y={p.y} width={p.width} height={p.height} radius={[r, r, 0, 0]}
          fill={n.ahead ? "var(--color-info-ahead)" : "var(--color-info)"}
        />
      )}
      {n.today && n.occ != null && (
        <text
          x={n.last ? p.x + p.width : p.x + p.width / 2} y={p.y - 6} textAnchor={n.last ? "end" : "middle"}
          fontSize={12} fontWeight={600} fill="var(--color-ink-900)" className="tabular"
        >
          {pct(n.occ)}
        </text>
      )}
    </g>
  );
}

/** The one reading tooltip: the value leads, the night follows. */
function NightTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Night }> }) {
  const n = payload?.[0]?.payload;
  if (!active || !n) return null;
  return (
    <div className="whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-xs leading-[17px] text-grey-600 tabular ring-1 ring-grey-200 shadow-popover">
      <b className="block text-sm leading-5 font-semibold text-ink-900">{pct(n.occ)}</b>
      {n.wd} {dateCompact(n.date)}
      {n.rooms != null && n.avail != null ? ` · ${n.rooms} of ${n.avail} rooms` : ""}
      {n.ahead ? " · booked so far" : ""}
    </div>
  );
}

function OccupancyByDay({ days, date, loading, monthName }: {
  days: MonthDay[]; date: string; loading: boolean; monthName: string;
}) {
  const [width, setWidth] = useState(0);
  if (loading) return <Skeleton className="h-[150px] w-full flex-1 rounded-md" />;
  if (!days.length) return <p className="py-6 text-center text-2xl text-grey-500">{DASH}</p>;

  const nights: Night[] = days.map((d, i) => {
    const wd = weekdayOf(d.date);
    return {
      day: String(Number(d.date.slice(8, 10))), date: d.date, wd,
      occ: d.occupancy, avail: d.available,
      /* Rooms sold as the hotel's switches count them, worked back from the
         share (a day use may be half a room), so the two always agree. */
      rooms: d.occupancy == null || d.available == null ? null : Math.round((d.occupancy / 100) * d.available * 2) / 2,
      ahead: d.date > date, today: d.date === date, weekend: wd === "Sat" || wd === "Sun",
      last: i === days.length - 1, count: days.length,
    };
  });
  const todayAt = nights.findIndex((x) => x.today);
  /* Every day number when there is room, else 1, 5, 10 ... and always today's. */
  const every = (width - AXIS) / nights.length >= 18;
  const kinds = new Set(nights.filter((x) => (x.occ ?? 0) > 0).map((x) => x.ahead));
  const todayNight = nights[todayAt];

  return (
    <>
      <div
        role="group"
        aria-label={`Occupancy by day, ${monthName}. ${todayNight?.occ != null ? `${pct(todayNight.occ)} today. ` : ""}Use the left and right arrow keys to read each night.`}
        className="relative h-[150px] flex-none sm:max-xl:h-[168px] xl:h-auto xl:min-h-[150px] xl:flex-1
                   [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-brand-orange"
      >
        <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%" onResize={(w) => setWidth(w)}>
            <BarChart data={nights} margin={{ top: 22, right: 0, bottom: 0, left: 0 }} barCategoryGap="19%" maxBarSize={24}>
              <CartesianGrid vertical={false} stroke="var(--color-grey-100)" />
              <XAxis
                dataKey="day" interval={0} height={24} tickLine={false} tickMargin={0}
                axisLine={{ stroke: "var(--color-grey-300)" }}
                tick={({ index, x, y }: { index: number; x: number | string; y: number | string }) => {
                  const t = { index, x: Number(x), y: Number(y) };
                  const night = nights[t.index]!;
                  const num = Number(night.day);
                  if (night.today) {
                    const w = Math.max(18, night.day.length * 7 + 10);
                    return (
                      <g>
                        <rect x={t.x - w / 2} y={t.y - 1} width={w} height={18} rx={9} fill="var(--color-ink-900)" />
                        <text x={t.x} y={t.y + 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff" className="tabular">{night.day}</text>
                      </g>
                    );
                  }
                  if (!every && !((num === 1 || num % 5 === 0) && (todayAt < 0 || Math.abs(t.index - todayAt) > 2))) return <g />;
                  return <text x={t.x} y={t.y + 12} textAnchor="middle" fontSize={12} fill="var(--color-grey-500)" className="tabular">{night.day}</text>;
                }}
              />
              <YAxis
                domain={[0, 100]} ticks={[0, 50, 100]} width={AXIS} tickMargin={8} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 12, fill: "var(--color-grey-500)", className: "tabular" }}
              />
              <Tooltip
                content={<NightTip />} isAnimationActive={false}
                cursor={{ fill: "var(--color-ink-900)", fillOpacity: 0.06 }}
                wrapperStyle={{ outline: "none", zIndex: 3 }}
              />
              <Bar dataKey="occ" shape={NightBar} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Two kinds of bar get a key; one kind gets none (DESIGN.md, Charts). */}
      {kinds.size > 1 && (
        <p className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs leading-[17px] text-grey-500" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-info" />Nights so far</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-info-ahead" />Booked ahead</span>
        </p>
      )}
    </>
  );
}
