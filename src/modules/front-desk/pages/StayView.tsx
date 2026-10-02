import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useRole, useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  ChevronRight, ChevronLeft, Globe, User, Building2,
  Sparkle, Wrench, AlertTriangle, CloudOff, RotateCw,
  BedDouble, DoorOpen, Users, LogIn, LogOut, CalendarDays, SprayCan, Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/documentTitle";
import { HouseFloor } from "@/modules/front-desk/flows/HouseFloor";
import { money, dateShort, dateLong, dateTime, timeOnly } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { AssignRoomFlow } from "@/modules/front-desk/flows/AssignRoomFlow";
import {
  Button, Segmented, Tooltip, Skeleton, ErrorState, EmptyState, toast, type Tone,
  Page, PageHeader, IconChip,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { StayDrawer } from "@/modules/front-desk/flows/StayDrawer";
import { getStayView, addDays, isWeekend, type ChartBar, type ChartRoom, type BarTone } from "@/modules/front-desk/data/stayview";
import { getStay, listStays } from "@/modules/front-desk/data/stays";
import { queryKeys, BUSINESS_DATE, setMyPreferences, type Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   STAY VIEW — the tape chart

   Fourteen days across seventeen rooms, on one screen, with no
   horizontal scroll. Density is the point: a clerk reads the whole
   fortnight at a glance and never loses their place.

   Layout is one CSS grid — a fixed room column, then fourteen equal
   date columns. Bars are grid children spanning their nights, so
   nothing is positioned by hand and nothing drifts at any width.

   Drag-to-move is Stage 4. The bar is a button with its own hit area
   so it can gain a handle later without being redrawn.
   ══════════════════════════════════════════════════════════════════ */

/* 27 September, the Fidato look: the Calendar speaks the Rooms tiles'
   colours. In house is solid blue, due out solid yellow, a confirmed
   booking a pale blue; checked out goes quiet grey (yellow is due out now). */
const BAR: Record<BarTone, string> = {
  "in-house": "bg-info text-white",
  confirmed: "bg-info-50 text-info ring-1 ring-inset ring-info-100",
  departed: "bg-grey-100 text-grey-600 ring-1 ring-inset ring-grey-200",
  /* The darker steps: white on tangerine was 2.54:1 and on rose 3.85:1,
     and the void bar's red on its own 25% tint was 3.11:1 — the three
     least readable marks on the busiest screen in the product. */
  "due-out": "bg-brand-yellow text-ink-900",
  "no-show": "bg-brand-rose-700 text-white",
  void: "bg-brand-red-50 text-brand-red-700 line-through",
  /* Grey, as on the booking lists (D27-63). */
  waiting: "bg-grey-100 text-grey-600 ring-1 ring-inset ring-grey-300 border-dashed",
};

const BAR_LABEL: Record<BarTone, string> = {
  "in-house": "In house",
  confirmed: "Confirmed",
  departed: "Checked out",
  "due-out": "Due out",
  "no-show": "No show",
  void: "Void",
  waiting: "Waiting for the hotel",
};

/* The stay panel's pill, from the bar's DERIVED tone — due-out is a
   status plus a date, which is why the chart passes its own. */
const BAR_TONE: Record<BarTone, Tone> = {
  /* In house blue and a booking still to arrive orange, as on the lists
     (the owner, 27 September). */
  "in-house": "info",
  confirmed: "accent",
  departed: "neutral",
  "due-out": "warning",
  "no-show": "danger",
  void: "danger",
  waiting: "neutral",
};

const PILLS = ["All", "Vacant", "Occupied", "Arrivals", "Reserved", "Blocked", "Due Out", "Dirty"] as const;

/* ONE VOCABULARY (the clarity plan, 15 September). The pills said
   Vacant / Occupied / Dirty / Blocked while the legend directly beneath
   them said Free / In house / Needs cleaning / Out of service — the same
   rooms in two languages, on the first screen a new clerk sees.

   The KEYS above do not change: the counts, the Dashboard and the tests
   read them. Only the words a person reads do.

   ⚠ "Vacant" IS "EMPTY", NOT "FREE". It counts every room with no guest
   in it — the free ones, the ones still to be cleaned, and the ones
   somebody is arriving into. A tile says "Free" only when none of that
   is true. Calling the pill "Free" would have put "Free 10" above eight
   tiles marked Free: a new contradiction in place of the old one. Empty
   = Free + Needs cleaning + Arriving, and that adds up on screen. */
const PILL_LABEL: Record<(typeof PILLS)[number], string> = {
  /* What it counts (the owner's D27-164, QA FD-13): out of service is apart. */
  All: "Sellable",
  Vacant: "Empty",
  Occupied: "In house",
  Arrivals: "Arriving",
  Reserved: "Reserved",
  Blocked: "Out of service",
  "Due Out": "Due out",
  Dirty: "Needs cleaning",
};
type Pill = (typeof PILLS)[number];

/** How the chart's rows are grouped. */
type GroupBy = "type" | "floor";

const SOURCE_ICON: Record<string, typeof Globe> = {
  "Walk-in": User,
  "Fidato Hotels": Building2,
};

/** 14 date columns after a fixed room column: 136px on a desk, 72 on a
    phone, where a night is a third of what is left (three and a quarter
    showing, the fourth peeking). The widths live in CHART_VARS. */
const GRID = "grid-cols-[var(--room)_repeat(14,minmax(var(--daymin),1fr))]";
const CHART_VARS = "[--room:136px] [--daymin:44px] max-lg:[--daymin:48px] max-sm:[--room:72px] max-sm:[--daymin:calc((100vw_-_72px)/3.25)]";

/* A tape chart is a wide instrument, and `1fr` columns do not refuse
   to be small — they just get smaller. On a 375px phone the fourteen
   days came out at SEVENTEEN pixels each: narrower than the numbers
   printed in them. Nothing was broken and nothing looked broken in a
   screenshot; measuring is what found it.

   There is no responsive trick that fits fourteen days on a phone.
   The honest answer is the one the rest of the app already uses for a
   wide table — let it scroll inside its own container, so the body
   never scrolls sideways and each day keeps a usable width.

   132px room column + 14 days at 44px. Above 748px this does nothing:
   `1fr` expands past the minimum and the desktop chart is untouched. */
const CHART_MIN_W = "min-w-[calc(var(--room)_+_14*var(--daymin))]";

/* When the chart pans, the room number must not leave with it —
   scrolling to Friday and losing which room you are reading is worse
   than not scrolling at all. Sticky is inert without overflow, so
   this too costs the desktop nothing. */
const ROOM_COL = "sticky left-0";

/* Stacking, once, in one place. The bars and the room column were
   both z-10, which is not a tie the browser breaks in your favour:
   it paints in DOM order, the bars come later, and panning the
   chart slid every booking straight over the room numbers.

   Only the screenshot showed it. Every measurement said the column
   was pinned, and it was — it was also underneath.

       30  date header, occupancy footer  (pinned top / bottom)
       20  room column                    (pinned left)
       10  reservation bars               (scroll with the chart) */

export default function StayViewPage({ view }: {
  /** Which of the two screens this is. `floor` is Rooms, at /stay;
      `calendar` is the fourteen-day chart, at /calendar. */
  view: "calendar" | "floor";
}) {
  const params = useParams();
  const fallbackHotel = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallbackHotel;
  const navigate = useNavigate();
  const scope = useSession((s) => s.scope);
  const hotels = useSession((s) => s.hotels);
  /* The question the server's gate asks of "Assign room" (roleGate's
     ROOMING: reservation edit, nobody added by name), from the same matrix.
     Housekeeping read Rooms and are refused it, so they are not offered it
     (D24-18). A free tile and an empty Calendar cell open the walk-in, whose
     booking roleGate's BOOK asks as reservation create (D24-27). */
  const role = useRole();
  const mayRoom = can(role, "edit", "reservation");
  const mayBook = can(role, "create", "reservation");

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("res");

  /* Open on the business date so the chart shows today first. */
  const [start, setStart] = useState(BUSINESS_DATE);
  const [pill, setPill] = useState<Pill>("All");

  /* ROOM TYPE OR FLOOR, PER PERSON, ON THE SERVER (087). The owner kept
     this switch on 14 September and asked for it to be remembered per
     person — so it is the same on the desk terminal and on a phone. */
  const [groupBy, setGroupByState] = useState<GroupBy>(scope?.roomGrouping ?? "type");
  const setGroupBy = (next: GroupBy) => {
    setGroupByState(next);
    if (scope) useSession.setState({ scope: { ...scope, roomGrouping: next } });
    void setMyPreferences({ roomGrouping: next }).then((r) => {
      if (!r.ok) toast.error("Not remembered", r.reason);
    });
  };

  /* ⚠ ROOMS AND CALENDAR ARE TWO SCREENS NOW, with their own addresses.
     They were one page with a toggle remembered in localStorage — per
     device — and the menu's "Calendar" link went to that one address,
     which opened on Rooms. Clicking "Calendar" did not show the calendar.

     The switch stays, as a shortcut between the two, and it moves the
     ADDRESS — carrying an open booking (?res=) with it. Where somebody
     starts is no longer this page's decision: the GM sets each person's
     first screen, and they can change their own (087). */
  useDocumentTitle(view === "calendar" ? "Calendar" : "Rooms");

  const chooseView = (next: "calendar" | "floor") => {
    if (next === view) return;
    navigate(`/h/${hotelId}/${next === "calendar" ? "calendar" : "stay"}${
      searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
  };
  const queryClient = useQueryClient();

  const chart = useQuery({
    queryKey: queryKeys.stayView(hotelId, start, BUSINESS_DATE),
    queryFn: () => getStayView(hotelId, start, BUSINESS_DATE),
  });

  /* THE LAST GOOD HOUSE STAYS ON SCREEN. Paging to another week asks for
     a new window; until it answers — or when it cannot — the window that
     last loaded stays there rather than becoming a skeleton or an error.

     ⚠ NOT `placeholderData`, which was the obvious tool and does not do
     this: React Query shows a placeholder only while the query is
     PENDING, and drops it the moment the query fails
     (query-core/src/queryObserver.ts, "use placeholderData if needed").
     The house would vanish at exactly the moment it was needed.

     So the last window that answered is recorded, and read back from the
     cache, which keeps it for a week (App.tsx). Only this hotel's, on this
     business date: any other would show one property's rooms while
     another loads (Rule 5), or yesterday's room states under today. */
  const [lastLoaded, setLastLoaded] = useState<
    { hotelId: string; businessDate: string; start: string } | null
  >(null);
  useEffect(() => {
    if (chart.isSuccess) setLastLoaded({ hotelId, businessDate: BUSINESS_DATE, start });
  }, [chart.isSuccess, chart.dataUpdatedAt, hotelId, start]);

  const fallbackKey =
    chart.data === undefined && lastLoaded && lastLoaded.start !== start
      && lastLoaded.hotelId === hotelId && lastLoaded.businessDate === BUSINESS_DATE
      ? queryKeys.stayView(hotelId, lastLoaded.start, BUSINESS_DATE)
      : null;
  const fallback = fallbackKey
    ? queryClient.getQueryData<Awaited<ReturnType<typeof getStayView>>>(fallbackKey)
    : undefined;
  /* `!== undefined`, not `??`: null is an ANSWER (a hotel with no rooms),
     and must not be papered over with an older window. */
  const data = chart.data !== undefined ? chart.data : fallback;
  const showingEarlierWindow = chart.data === undefined && fallback !== undefined;

  /* WHO IS IN EACH ROOM TODAY. The chart's bars belong to its WINDOW;
     this belongs to the business date. A guest who arrived on the 4th
     and leaves on the 5th has no bar in a window starting on the 5th —
     they occupied the night of the 4th — and the floor view was showing
     "DUE OUT" over an empty tile while they were still in the room.

     Only fetched in the floor view, because the chart does not need it
     and a query nobody reads is a query that goes wrong unnoticed. */
  const stayList = useQuery({
    queryKey: queryKeys.stays(hotelId),
    queryFn: () => listStays(hotelId),
    enabled: view === "floor",
  });
  const todaysStayList = stayList.data;

  const todaysStays = useMemo(() => {
    const map = new Map<string, Stay>();
    for (const s of todaysStayList ?? []) {
      if (!s.roomNumber) continue;
      /* The same three statuses `room.state` is built from, so the tile's
         label and the name under it cannot answer different questions. */
      const live = s.status === "in-house" || s.status === "due-out"
        || (s.status === "due-in" && s.arrival === BUSINESS_DATE);
      /* The guest IN the room is its name: an arrival given the room ahead
         (D24-26) must not print under "Due out" (the owner, 24 September). */
      const arrivalBehindGuest = s.status === "due-in" && map.has(s.roomNumber);
      if (live && !arrivalBehindGuest) map.set(s.roomNumber, s);
    }
    return map;
  }, [todaysStayList]);

  /* AN EMPTY ROOM OPENS THE ONE PAGE (D27-163), on that room and night: a
     walk-in today, a booking for a later night. The walk-in dialog was a
     second form asking the same questions. */
  const bookRoom = (roomNumber: string, date: string) =>
    navigate(`/h/${hotelId}/book?room=${encodeURIComponent(roomNumber)}&date=${date}`);

  const selected = useMemo(() => {
    if (!selectedId || !data) return null;
    for (const type of data.roomTypes) {
      for (const room of type.rooms) {
        const bar = room.bars.find((b) => b.stay.id === selectedId);
        if (bar) return bar;
      }
    }
    return null;
  }, [selectedId, data]);

  /* A deep link can name a stay outside the fortnight on screen — from
     the dashboard, a search result, or a link someone shared. Move the
     window to it rather than opening an empty panel. */
  const missingFromWindow = !!selectedId && !!data && !selected;
  const { data: offscreen } = useQuery({
    queryKey: queryKeys.stay(hotelId, selectedId ?? ""),
    queryFn: () => getStay(hotelId, selectedId!),
    enabled: missingFromWindow,
  });

  useEffect(() => {
    if (offscreen && missingFromWindow) setStart(offscreen.arrival);
  }, [offscreen, missingFromWindow]);

  const openStay = (id: string) => {
    searchParams.set("res", id);
    setSearchParams(searchParams, { replace: false });
  };
  const closeStay = () => {
    searchParams.delete("res");
    setSearchParams(searchParams, { replace: false });
  };

  /* ── Four states, not one ──────────────────────────────────────────
     This was `if (isLoading || !data) return <twelve grey bars>`, and
     nothing else. With the server unreachable the query FAILS, isLoading
     goes false, data stays undefined — and the bars stayed forever, under
     the offline banner's promise that anything still possible would be
     held. With the device itself offline React Query PAUSES the request
     instead of failing it, which reached the same bars by another road.

     Floor view reads two queries: the house, and who is in each room
     today. Either one failing means the tiles are not current. */
  const title = view === "calendar" ? "Calendar" : "Rooms";
  const hotelName = hotels.find((h) => h.code === hotelId)?.name;
  const reads = view === "floor" ? [chart, stayList] : [chart];
  const failure = reads.find((q) => q.isError)?.error ?? null;
  const paused = reads.some((q) => q.isPaused);
  const refreshing = reads.some((q) => q.isFetching);
  const retry = () => { for (const q of reads) void q.refetch(); };

  /* `null` is a successful answer: a hotel with no rooms at all. It drew the
     loading skeleton forever until FD-5 — the owner's words, D17-23. */
  if (data === null) {
    return (
      <StayViewFrame title={title}>
        <EmptyState
          title="No rooms set up yet"
          description="Add them in Room types."
        />
      </StayViewFrame>
    );
  }

  if (!data) {
    if (data === undefined && paused) {
      return (
        <StayViewFrame title={title}>
          <ErrorState
            title="No connection"
            description="This device is offline, so the rooms cannot load. They load by themselves as soon as it is back."
          />
        </StayViewFrame>
      );
    }
    if (data === undefined && failure && !refreshing) {
      return (
        <StayViewFrame title={title}>
          <ErrorState
            title="The rooms did not load"
            error={failure}
            /* The unreachable sentence from `api()` ends "Showing the last
               data received", and here there is none to show. */
            description={isUnreachable(failure)
              ? "Could not reach the server, and there are no rooms from earlier to show in their place."
              : undefined}
            onRetry={retry}
          />
        </StayViewFrame>
      );
    }
    return <StayViewSkeleton view={view} title={title} />;
  }

  const { dates, roomTypes, footer, counts } = data;

  /* WHEN THE HOUSE ON SCREEN WAS LOADED — the earlier window's own age
     when that is what is showing, not this query's. */
  const shownAt = showingEarlierWindow && fallbackKey
    ? queryClient.getQueryState(fallbackKey)?.dataUpdatedAt
    : chart.dataUpdatedAt;
  const stale = failure !== null || paused;

  /* Regroup by floor when asked.

     The per-date availability numbers on a type group are that TYPE's
     inventory, so they cannot simply be reused under a floor heading —
     a floor holding four of ten Superiors would otherwise claim the
     whole type's availability. They are summed from the rooms actually
     on the floor instead, and the rate is dropped: a floor has no one
     rate, and printing one type's would be picking a number. */
  const groups = groupBy === "type"
    ? roomTypes
    : [...new Set(roomTypes.flatMap((g) => g.rooms.map((r) => r.floor)))]
        .sort((a, b) => a - b)
        .map((floor) => {
          const rooms = roomTypes
            .flatMap((g) => g.rooms)
            .filter((r) => r.floor === floor)
            .sort((a, b) => a.number.localeCompare(b.number));
          return {
            type: floor === 0 ? "Ground floor" : `Floor ${floor}`,
            rooms,
            perDate: dates.map((date, i) => ({
              date,
              available: rooms.filter(
                (r) =>
                  !r.outOfService &&
                  !r.bars.some(
                    (b) =>
                      b.tone !== "void" &&
                      b.startIndex <= i &&
                      b.startIndex + b.span - 1 >= i,
                  ),
              ).length,
              rate: null,
            })),
          };
        });

  /** Which rooms the active filter pill leaves on screen.

      This reads the SAME `room.state` the pill counts are computed
      from, so a pill can never say six and then show nine. Out-of-
      service rooms are not part of the sellable house, so they appear
      only under "Blocked" — which is why "Sellable" reads 17 while eighteen
      rooms physically exist. */
  const roomVisible = (room: ChartRoom) => {
    if (pill === "Blocked") return room.outOfService;
    /* A guest in a room a block has started on is still in house (D21-36),
       so In house shows it as its count does. */
    if (pill === "Occupied") return room.state.occupied;
    if (room.outOfService) return false;
    switch (pill) {
      case "Vacant": return !room.state.occupied;
      case "Arrivals": return room.state.arriving;
      case "Reserved": return room.state.reserved;
      case "Due Out": return room.state.dueOut;
      case "Dirty": return room.state.dirty;
      default: return true;
    }
  };

  /* The page's head, the same on both screens: the business date, the
     title, the property; on the right, the view, the grouping and the one
     action. On a phone the view switch takes the full width. */
  const head = (
    <PageHeader
      eyebrow={`Business date · ${dateLong(BUSINESS_DATE)}`}
      title={title}
      description={hotelName}
      actions={
        <div className="grid grid-cols-[1fr_auto] gap-2 w-full sm:flex sm:items-center sm:w-auto sm:flex-wrap">
          {/* Which SHAPE, before which grouping — a person picks the
              view they are working in and then how it is sorted. */}
          <Segmented<"calendar" | "floor">
            value={view}
            onChange={chooseView}
            className="col-span-2 flex [&>button]:flex-1 sm:inline-flex"
            options={[
              { value: "calendar", label: "Calendar" },
              { value: "floor", label: "Rooms" },
            ]}
          />
          {/* This was `value="Room type"` with `onChange={() => undefined}`
              — a toggle offering a view it could not produce. Every room
              already carries its floor, so grouping by it costs nothing
              but was never wired. */}
          <Segmented<GroupBy>
            value={groupBy}
            onChange={setGroupBy}
            className="flex [&>button]:flex-1 sm:inline-flex"
            options={[
              { value: "type", label: "Room type" },
              { value: "floor", label: "Floor" },
            ]}
          />
          {/* Was a <Button> with no onClick — it looked live and did
              nothing. The flow it needed did not exist: check-in
              assigns a room AT arrival, and nothing assigned one
              before it. */}
          {mayRoom && <AssignRoomFlow hotelId={hotelId} />}
        </div>
      }
    />
  );

  const staleBanner = stale && (
    <StaleRooms
      failure={failure}
      shownAt={shownAt}
      missingWindow={showingEarlierWindow ? start : null}
      refreshing={refreshing}
      onRetry={paused && !failure ? undefined : retry}
    />
  );

  const drawers = (
    <>
      {/* ── Detail panel — the chart stays visible behind it ──────── */}
      <StayDrawer
        hotelId={hotelId}
        stay={selected?.stay ?? null}
        businessDate={BUSINESS_DATE}
        status={selected ? { tone: BAR_TONE[selected.tone], label: BAR_LABEL[selected.tone] } : null}
        onClose={closeStay}
      />
    </>
  );

  /* ── Rooms: the house as tiles, for today ────────────────────────────
     Today's rooms as tiles, in the POS floor's language because it is the
     same job: somebody standing up with a phone asking which of these is
     free and which needs something done to it. It renders the data the
     chart already loaded — a second query would be a second answer, and
     the two would differ on the day it mattered. The SAME filter honours
     it, so a tile cannot say six here and nine on the chart.

     The whole page scrolls, head and all, so a phone gives the rooms the
     screen. A new clerk's first jobs (Start here) sit above the rooms and
     scroll away with the head. */
  if (view === "floor") {
    return (
      <div className="h-full overflow-y-auto scrollbar-quiet">
        <Page>
          {head}
          <FilterTiles pill={pill} onPick={setPill} counts={counts} />
          {staleBanner}
          <StartHere className="mb-5" />
          <HouseFloor
            groups={groups.map((g) => ({
              ...g,
              rooms: g.rooms.filter(roomVisible),
            })).filter((g) => g.rooms.length > 0)}
            businessDate={BUSINESS_DATE}
            todaysStays={todaysStays}
            onOpenStay={openStay}
            onWalkIn={mayBook ? bookRoom : undefined}
          />
        </Page>
        {drawers}
      </div>
    );
  }

  /* ── Calendar: one chart card that fills the screen ───────────────────
     The head and the filters stay put; the chart scrolls inside its card,
     both ways, with the dates and the footer pinned to it and the room
     column pinned to its left. On a phone it shows three nights with the
     fourth peeking and snaps night by night; the page never scrolls
     sideways. Start here sits above, capped, because a card inside the
     chart would scroll off sideways. */
  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-[1600px] mx-auto px-5 pt-6 pb-5 sm:px-7 sm:pt-8">
      <div className="shrink-0">
        {head}
        <FilterTiles pill={pill} onPick={setPill} counts={counts} />
        {staleBanner}
      </div>
      <StartHere className="shrink-0 max-h-[45%] overflow-y-auto scrollbar-quiet mb-5" />

      <div className="flex-1 min-h-0 flex flex-col bg-white border border-grey-200 rounded-lg overflow-hidden
                      max-sm:-mx-5 max-sm:rounded-none max-sm:border-x-0">
        {/* The chart's own toolbar: the fortnight, and what the bars mean. */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 sm:px-3 sm:py-2.5 border-b border-grey-200">
          <Button variant="secondary" size="icon" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-1.5 text-md font-semibold text-ink-900 tabular whitespace-nowrap">
            {dateShort(dates[0]!)} – {dateShort(dates[dates.length - 1]!)}
          </span>
          {start !== BUSINESS_DATE && (
            <Button variant="ghost" size="sm" onClick={() => setStart(BUSINESS_DATE)}>
              Today
            </Button>
          )}
          <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-grey-600 max-sm:w-full sm:ml-auto" aria-hidden>
            {(["in-house", "due-out", "confirmed"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <i className={cn("w-[18px] h-2.5 rounded-[3px]", BAR[t])} />
                {BAR_LABEL[t]}
              </span>
            ))}
          </p>
        </div>

        <div className={cn(
          "flex-1 min-h-0 overflow-auto overscroll-x-contain scrollbar-quiet",
          CHART_VARS,
          "max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-pl-[72px]",
          "max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]",
        )}>
        <div className={CHART_MIN_W}>
          {/* Date header */}
          <div className={cn("grid sticky top-0 z-30 bg-white border-b border-grey-200", GRID)}>
            <div className={cn(
              "flex items-center px-3.5 max-sm:px-2.5 h-[50px] text-xs font-semibold uppercase tracking-[0.025em] text-grey-500 border-r border-grey-200",
              /* The corner: pinned in both directions, so it outranks
                 the row cells that slide under it AND the date header
                 it sits inside. Opaque, or the chart shows through. */
              ROOM_COL, "z-10 bg-white",
            )}>
              <span className="max-sm:sr-only">Room</span>
            </div>
            {dates.map((d) => (
              <div
                key={d}
                data-date-col={d}
                className={cn(
                  "grid place-content-center text-center h-[50px] border-r border-grey-100 last:border-r-0 max-sm:snap-start",
                  isWeekend(d) && "bg-grey-50",
                  d === BUSINESS_DATE && "bg-ink-900 text-white",
                )}
              >
                <div className={cn(
                  "text-xs font-semibold uppercase tracking-[0.025em]",
                  d === BUSINESS_DATE ? "text-white/70" : "text-grey-500",
                )}>
                  {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
                    weekday: "short", timeZone: "UTC",
                  })}
                </div>
                <div className={cn(
                  "text-md font-semibold tabular",
                  d === BUSINESS_DATE ? "text-white" : "text-ink-900",
                )}>
                  {d.slice(-2)}
                </div>
              </div>
            ))}
          </div>

          {/* Room type groups */}
          {groups.map((group) => {
            const visibleRooms = group.rooms.filter(roomVisible);
            if (visibleRooms.length === 0) return null;

            return (
              <div key={group.type}>
                {/* Group row — availability over rate, per date, on two
                    levelled lines */}
                <div className={cn("grid bg-grey-50 border-b border-grey-200", GRID)}>
                  {/* ALWAYS OPEN (the owner's D27-236, 4.1): a room type's rooms
                      are never folded away, so the head is a label, not a
                      button. */}
                  <div
                    className={cn(
                      "flex items-center gap-1 px-3 max-sm:px-2.5 h-11 text-left border-r border-grey-200",
                      ROOM_COL, "z-20 bg-grey-50",
                    )}
                  >
                    <span className="text-sm max-sm:text-xs font-semibold text-ink-900 truncate">
                      {group.type}
                    </span>
                    <span className="ml-auto h-5 px-[7px] rounded-full bg-white ring-1 ring-inset ring-grey-200 text-xs font-semibold leading-5 text-grey-600 tabular max-sm:hidden">
                      {visibleRooms.length}
                    </span>
                  </div>

                  {group.perDate.map((cell) => (
                    <div
                      key={cell.date}
                      className="grid grid-rows-[20px_16px] place-content-center text-center border-r border-grey-200 last:border-r-0"
                    >
                      <div className={cn(
                        "text-sm font-semibold tabular",
                        cell.available === 0 ? "text-brand-red-700" : "text-ink-900",
                      )}>
                        {cell.available}
                      </div>
                      <div className="text-xs leading-4 text-grey-500 tabular">
                        {/* A dash when the hotel has not priced this type.
                            It used to read "0.0k" for every property whose
                            room types were not called Superior or Deluxe,
                            which looks like a rate rather than an absence. */}
                        {cell.rate === null
                          ? "-"
                          : `${(cell.rate / 1000).toFixed(1)}k`}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Room rows */}
                {visibleRooms.map((room) => (
                  <div
                    key={room.number}
                    data-room-row={room.number}
                    className={cn("grid border-b border-grey-100 group", GRID)}
                  >
                    <div className={cn(
                      "flex items-center gap-1.5 px-3.5 max-sm:px-2.5 h-10 border-r border-grey-200",
                      /* bg-white and not transparent: the day cells
                         slide underneath this, not behind the page. */
                      ROOM_COL, "z-20 bg-white",
                    )}>
                      <span className="text-sm font-medium text-ink-900 tabular">
                        {room.number}
                      </span>
                      {/* Two status icons, as the live system shows */}
                      <span className="flex items-center gap-0.5 ml-auto">
                        <Tooltip content={room.housekeeping === "dirty" ? "Dirty" : "Clean"}>
                          <Sparkle
                            className={cn(
                              "size-3",
                              room.housekeeping === "dirty" ? "text-brand-yellow" : "text-grey-300",
                            )}
                          />
                        </Tooltip>
                        <Tooltip content={room.outOfService ? "Out of service" : "In service"}>
                          <Wrench
                            className={cn(
                              "size-3",
                              room.outOfService ? "text-brand-red" : "text-grey-300",
                            )}
                          />
                        </Tooltip>
                      </span>
                    </div>

                    {/* Empty cells — clicking one starts a booking there,
                        for whoever may book (D24-27); a plain cell for
                        anybody else. */}
                    {dates.map((d, i) => {
                      const cell = cn(
                        "h-10 border-r border-grey-100 last:border-r-0 transition-colors duration-150",
                        isWeekend(d) && "bg-grey-50",
                        d === BUSINESS_DATE && "bg-ink-900/[0.035]",
                      );
                      /* gridRow 1, like the bars: with a column alone,
                         auto-placement put every cell under a bar - and
                         each one after it - into a second row (FD-13). */
                      const place = { gridColumn: i + 2, gridRow: 1 };
                      return mayBook ? (
                        <button
                          key={d}
                          type="button"
                          onClick={() => bookRoom(room.number, d)}
                          aria-label={`Book room ${room.number} on ${d}`}
                          className={cn(cell, "hover:bg-brand-orange-50")}
                          style={place}
                        />
                      ) : <div key={d} className={cell} style={place} />;
                    })}

                    {/* Bars sit on top of the cells, spanning their nights */}
                    {room.bars.map((bar) => (
                      <BookingBar
                        key={bar.stay.id}
                        bar={bar}
                        onOpen={() => openStay(bar.stay.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Pinned footer: what is left, and how full, on two levelled lines */}
          <div className={cn("grid sticky bottom-0 z-30 bg-white border-t border-grey-300", GRID)}>
            <div className={cn(
              "flex flex-col justify-center px-3.5 max-sm:px-2.5 h-[58px] border-r border-grey-200",
              ROOM_COL, "z-10 bg-white",
            )}>
              <div className="text-sm font-semibold text-ink-900">Available</div>
              <div className="text-xs text-grey-600 max-sm:hidden">Occupancy</div>
            </div>
            {footer.map((f) => (
              <div
                key={f.date}
                className="grid grid-rows-[20px_4px_16px] content-center justify-items-center gap-1 px-2.5 border-r border-grey-100 last:border-r-0"
              >
                <div className="text-sm font-semibold text-ink-900 tabular">
                  {f.availableInventory}
                </div>
                <div className="w-full h-1 rounded-full bg-grey-100 overflow-hidden">
                  <div
                    className="h-full bg-brand-orange rounded-full"
                    style={{ width: `${f.occupancyPct}%` }}
                  />
                </div>
                <div className="text-xs leading-4 text-grey-500 tabular">
                  {Math.round(f.occupancyPct)}%
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      {drawers}
    </div>
  );
}

/* ── The filters: a row of level count tiles ─────────────────────────
   They filter, they sum up, and their chips are the key, so there is no
   separate legend (the fidato-design filter tiles). The chosen one is
   navy; today's jobs are warm while there is some to do. The label comes
   first in the markup and sits under the count on screen, so each reads
   "In house 2". On a phone the row scrolls inside itself, snapping. */

const PILL_ICON: Record<Pill, typeof Globe> = {
  All: BedDouble, Vacant: DoorOpen, Occupied: Users, Arrivals: LogIn,
  Reserved: CalendarDays, Blocked: Wrench, "Due Out": LogOut, Dirty: SprayCan,
};
const PILL_CHIP: Record<Pill, "neutral" | "orange" | "yellow" | "blue" | "green"> = {
  All: "neutral", Vacant: "neutral", Occupied: "blue", Arrivals: "orange",
  Reserved: "neutral", Blocked: "neutral", "Due Out": "yellow", Dirty: "green",
};

function FilterTiles({ pill, onPick, counts }: {
  pill: Pill; onPick: (p: Pill) => void; counts: Record<string, number>;
}) {
  return (
    <div
      role="group"
      aria-label="Filter rooms"
      className="mb-5 grid grid-cols-4 xl:grid-cols-8 gap-2
                 max-sm:flex max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-5
                 max-sm:-mx-5 max-sm:px-5 max-sm:py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]"
    >
      {PILLS.map((p) => {
        const n = counts[p] ?? 0;
        const on = pill === p;
        const Icon = PILL_ICON[p];
        const job = !on && n > 0 ? (p === "Arrivals" ? "orange" : p === "Due Out" ? "yellow" : null) : null;
        return (
          <button
            key={p}
            type="button"
            data-filter-pill={p}
            aria-pressed={on}
            onClick={() => onPick(p)}
            className={cn(
              "press-tile row-span-2 grid grid-rows-subgrid gap-y-1 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset",
              "max-sm:shrink-0 max-sm:min-w-[116px] max-sm:snap-start max-sm:px-3.5 max-sm:py-3",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              on ? "bg-ink-900 ring-ink-900"
                : job === "orange" ? "bg-brand-orange-50 ring-brand-orange-100"
                  : job === "yellow" ? "bg-brand-yellow-50 ring-brand-yellow-100"
                    : "bg-white ring-grey-200 hover:ring-grey-400",
            )}
          >
            <span className={cn(
              "row-start-2 text-sm leading-[18px] max-sm:whitespace-nowrap",
              on ? "text-white/72" : "text-grey-600",
            )}>
              {PILL_LABEL[p]}
            </span>
            <span className="row-start-1 flex items-center gap-2">
              <IconChip size={24} tone={on ? "glass" : p === "Dirty" && n > 0 ? "neutral" : PILL_CHIP[p]}><Icon /></IconChip>
              <b className={cn(
                "inline-flex items-center gap-1 text-xl leading-6 font-semibold tabular tracking-[-0.02em]",
                on ? "text-white"
                  : p === "Blocked" && n > 0 ? "text-brand-orange-700"
                    : p === "Dirty" && n === 0 ? "text-success-600" : "text-ink-900",
              )}>
                {n}
                {p === "Dirty" && n === 0 && !on && <Check className="size-3.5" aria-hidden />}
              </b>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── When there is nothing to draw ──────────────────────────────────── */

/** `api()` throws status 0 when the request never reached a server. */
function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/** When something loaded: the time if it was today, the date too if not —
    a desk left open overnight must not read yesterday's house as "4:10 pm". */
function loadedAt(ms: number): string {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? timeOnly(d) : dateTime(d);
}

/** The screen's own heading above whatever stands in for the house, so a
    clerk always knows which screen failed. */
function StayViewFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto scrollbar-quiet">
      <Page>
        <PageHeader title={title} />
        {children}
      </Page>
    </div>
  );
}

/* SHAPED LIKE WHAT IT STANDS IN FOR: the head, the eight filter tiles, then
   tiles on Rooms or a fortnight grid on Calendar, so the house lands where
   the grey was. */
function StayViewSkeleton({ view, title }: { view: "calendar" | "floor"; title: string }) {
  return (
    <StayViewFrame title={title}>
      <div
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
        data-rooms-skeleton={view}
      >
        <div className="mb-5 grid grid-cols-4 xl:grid-cols-8 gap-2 max-sm:flex max-sm:overflow-hidden">
          {PILLS.map((p) => <Skeleton key={p} className="h-[66px] rounded-lg max-sm:min-w-[116px]" />)}
        </div>
        {view === "floor" ? (
          [10, 7].map((tiles, s) => (
            <section key={s} className="mb-6">
              <Skeleton className="h-5 w-28 mb-3" />
              <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-2.5">
                {Array.from({ length: tiles }).map((_, i) => (
                  <Skeleton key={i} className="h-[92px] rounded-lg" />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className={cn("bg-white border border-grey-200 rounded-lg overflow-hidden", CHART_VARS)}>
            <div className={CHART_MIN_W}>
              <div className={cn("grid border-b border-grey-200", GRID)}>
                <div className="px-3 h-[50px] flex items-center border-r border-grey-200">
                  <Skeleton className="h-3 w-10" />
                </div>
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center justify-center gap-1 h-[50px] border-r border-grey-100 last:border-r-0">
                    <Skeleton className="h-3 w-6" />
                    <Skeleton className="h-4 w-4" />
                  </div>
                ))}
              </div>
              {Array.from({ length: 10 }).map((_, r) => (
                <div key={r} className={cn("grid border-b border-grey-100", GRID)}>
                  <div className="flex items-center px-3 h-10 border-r border-grey-200">
                    <Skeleton className="h-3.5 w-10" />
                  </div>
                  <div
                    className="self-center mx-0.5"
                    style={{ gridColumn: `${2 + ((r * 5) % 9)} / span ${2 + (r % 4)}`, gridRow: 1 }}
                  >
                    <Skeleton className="h-[26px] w-full rounded-[7px]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </StayViewFrame>
  );
}

/* THE HOUSE ON SCREEN IS NOT CURRENT, and says so. A tile that reads Free
   from an hour ago is how a room gets sold twice, so the grid stays — the
   clerk can still read the house — with its age above it.

   Two tones, as the offline bar has: no connection is a normal condition
   and is said calmly; a server that answered with an error is not. */
function StaleRooms({ failure, shownAt, missingWindow, refreshing, onRetry }: {
  failure: Error | null;
  shownAt: number | undefined;
  /** The window asked for, when an earlier one is standing in for it. */
  missingWindow: string | null;
  refreshing: boolean;
  /** Absent while the device is offline — nothing to retry until it is back. */
  onRetry?: () => void;
}) {
  const noConnection = failure === null || isUnreachable(failure);
  const age = shownAt ? `as they were at ${loadedAt(shownAt)}` : "possibly out of date";

  return (
    <div
      role="status"
      data-stale-rooms
      className={cn(
        "mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3",
        noConnection
          ? "border-brand-yellow-100 bg-brand-yellow-50"
          : "border-brand-red-100 bg-brand-red-50",
      )}
    >
      {noConnection
        ? <CloudOff className="size-4 shrink-0 text-grey-600" />
        : <AlertTriangle className="size-4 shrink-0 text-brand-red" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">
          {noConnection
            ? `No connection - these rooms are ${age}.`
            : `The rooms did not refresh - these are ${age}.`}
          {missingWindow && ` The fortnight from ${dateShort(missingWindow)} has not loaded.`}
        </p>
        {!noConnection && (
          <p className="text-sm text-grey-600 mt-0.5">{failure.message}</p>
        )}
        {!onRetry && (
          <p className="text-sm text-grey-600 mt-0.5">
            They refresh by themselves when the connection is back.
          </p>
        )}
      </div>
      {onRetry && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onRetry}
          loading={refreshing}
          leadingIcon={<RotateCw className="size-4" />}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

function BookingBar({ bar, onOpen }: { bar: ChartBar; onOpen: () => void }) {
  /* A globe for anything not recognised, INCLUDING null. There is no
     icon meaning "we do not know where this came from", and a walk-in
     figure would be a guess — see defect 219, where exactly that guess
     was wired in. */
  const Icon = SOURCE_ICON[bar.stay.source ?? ""] ?? Globe;
  const nights = bar.stay.isDayUse ? "day use" : `${bar.stay.nights} night${bar.stay.nights === 1 ? "" : "s"}`;

  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <p className="font-medium">{bar.stay.guest}</p>
          <p className="tabular">
            {dateShort(bar.stay.arrival)} → {dateShort(bar.stay.departure)} · {nights}
          </p>
          <p className="tabular">
            {bar.stay.isComplimentary ? "Complimentary" : money(bar.stay.offeredTariff)}
            {/* No balance for a role given no bills (D27-143). */}
            {bar.balance !== undefined && <> · balance {money(bar.balance)}</>}
          </p>
        </div>
      }
    >
      <button
        type="button"
        data-booking-bar={bar.stay.id}
        onClick={onOpen}
        style={{ gridColumn: `${bar.startIndex + 2} / span ${bar.span}`, gridRow: 1 }}
        className={cn(
          "relative z-10 self-center mx-0.5 h-6 rounded-sm px-1.5",
          "flex items-center gap-1 min-w-0 text-2xs font-medium",
          "transition-[filter] duration-150 hover:brightness-110",
          BAR[bar.tone],
          bar.clippedStart && "rounded-l-none ml-0",
          bar.clippedEnd && "rounded-r-none mr-0",
        )}
      >
        <Icon className="size-2.5 shrink-0 opacity-80" />
        <span className="truncate">{bar.stay.guest}</span>
      </button>
    </Tooltip>
  );
}
