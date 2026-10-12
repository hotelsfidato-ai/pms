import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Check, ChevronRight, BedDouble, IndianRupee, TrendingUp, Banknote,
  LogIn, LogOut, Users, SprayCan, Wallet, ReceiptText,
  Building2, UserX, ClipboardList, ChartColumn, Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, dateLong, addDays } from "@/lib/format";
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
import { getStayView, fetchStays, type ChartRoom } from "@/modules/front-desk";
import type { DayStatistics } from "@/data/repositories";
import { listDailyStatistics } from "@/modules/reports/data/statistics";
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

  /* TODAY'S WORK — only counts the system holds (the owner's yes, 27
     September, kept in D27-243). Arrivals: today's, of which still to come
     (no-shows and cancellations are not work). Due out: today's
     departures, of which still here. In house and Needs cleaning: the
     Rooms board's own counts. */
  const today = (() => {
    if (!stays.data || !view.data) return null;
    const all = stays.data;
    const arriving = all.filter((s) => s.arrival === date && s.status !== "cancelled" && s.status !== "no-show");
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

  const figures: Array<{ icon: LucideIcon; label: string; term?: TermKey; f?: Figure }> = [
    /* "ARR" on the screen (the owner's D27-243); the printed Manager report
       keeps its "Average Daily Rate (ADR)", which `pick` reads above. */
    { icon: IndianRupee, label: "Average rate (ARR)", term: "adr", f: adr },
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
              <div className={cn(
                "text-xl sm:text-2xl leading-[30px] font-semibold tabular tracking-[-0.022em] text-right sm:text-left",
                f?.today == null && !loading ? "text-grey-500" : "text-ink-900",
              )}>
                {fig(cash(f?.today))}
              </div>
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
                note={methods.length ? methods.map((m) => `${m.label} ${money(m.today)}`) : ["Nothing taken yet today"]}
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
