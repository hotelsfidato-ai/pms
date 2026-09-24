import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useSession } from "@/lib/session";
import {
  ChevronDown, ChevronRight, ChevronLeft, Globe, User, Building2,
  Sparkle, Wrench, AlertTriangle, CloudOff, RotateCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/documentTitle";
import { HouseFloor } from "@/modules/front-desk/flows/HouseFloor";
import { money, dateShort, dateTime, timeOnly } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { AssignRoomFlow } from "@/modules/front-desk/flows/AssignRoomFlow";
import {
  Button, Segmented, Tooltip, Skeleton, ErrorState, EmptyState, toast, type Tone,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { StayDrawer } from "@/modules/front-desk/flows/StayDrawer";
import { WalkInFlow } from "@/modules/front-desk/flows/WalkInFlow";
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

const BAR: Record<BarTone, string> = {
  "in-house": "bg-success text-white",
  confirmed: "bg-info text-white",
  departed: "bg-brand-yellow text-ink-900",
  /* The darker steps: white on tangerine was 2.54:1 and on rose 3.85:1,
     and the void bar's red on its own 25% tint was 3.11:1 — the three
     least readable marks on the busiest screen in the product. */
  "due-out": "bg-brand-tangerine-700 text-white",
  "no-show": "bg-brand-rose-700 text-white",
  void: "bg-brand-red-50 text-brand-red-700 line-through",
};

const BAR_LABEL: Record<BarTone, string> = {
  "in-house": "In house",
  confirmed: "Confirmed",
  departed: "Checked out",
  "due-out": "Due out",
  "no-show": "No show",
  void: "Void",
};

/* The stay panel's pill, from the bar's DERIVED tone — due-out is a
   status plus a date, which is why the chart passes its own. */
const BAR_TONE: Record<BarTone, Tone> = {
  "in-house": "success",
  confirmed: "info",
  departed: "neutral",
  "due-out": "warning",
  "no-show": "danger",
  void: "danger",
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
  All: "All",
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

/** 14 date columns after a fixed room column. */
const GRID = "grid-cols-[132px_repeat(14,minmax(0,1fr))]";

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
const CHART_MIN_W = "min-w-[748px]";

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
      if (live) map.set(s.roomNumber, s);
    }
    return map;
  }, [todaysStayList]);

  /* An empty cell opens a walk-in for that room and date. */
  const walkIn = useMemo(() => {
    if (!selectedId?.startsWith("new:")) return null;
    const [, roomNumber, date] = selectedId.split(":");
    return roomNumber && date ? { roomNumber, date } : null;
  }, [selectedId]);

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
  const missingFromWindow = !!selectedId && !!data && !selected && !selectedId.startsWith("new:");
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
      only under "Blocked" — which is why "All" reads 17 while eighteen
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-grey-200 px-4 sm:px-5 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* THE PAGE'S NAME. This was one of four screens with no heading
              at all — and the only one staff spend the day on. A screen
              reader announced nothing, and a new clerk had only the
              toggle further along to say where they were. */}
          <h1 className="text-lg font-semibold text-ink-900">
            {view === "calendar" ? "Calendar" : "Rooms"}
          </h1>
          {/* WRAPS (FD-7, D17-41): on a phone the week's dates and "Today" ran
              past the right edge of the screen. */}
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="secondary" size="sm"
              onClick={() => setStart(addDays(start, -7))}
              aria-label="Previous week"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="secondary" size="sm"
              onClick={() => setStart(addDays(start, 7))}
              aria-label="Next week"
            >
              <ChevronRight className="size-4" />
            </Button>
            <span className="ml-2 text-base font-medium text-ink-900 tabular whitespace-nowrap">
              {dateShort(dates[0]!)} – {dateShort(dates[dates.length - 1]!)}
            </span>
            {start !== BUSINESS_DATE && (
              <Button variant="ghost" size="sm" onClick={() => setStart(BUSINESS_DATE)}>
                Today
              </Button>
            )}
          </div>

          {/* WRAPS ON A PHONE, and only takes the right-hand side once
              there is one. `ml-auto` with no wrap pushed this group to
              461px inside a 343px parent, so "Assign room" sat at x=477
              in a 375px viewport — present, styled, and unreachable.

              It was already tight with one toggle; the second made it
              certain. A control that cannot be touched is not a control. */}
          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            {/* This was `value="Room type"` with `onChange={() => undefined}`
                — a toggle offering a view it could not produce. Every room
                already carries its floor, so grouping by it costs nothing
                but was never wired. */}
            {/* Which SHAPE, before which grouping — a person picks the
                view they are working in and then how it is sorted. */}
            <Segmented<"calendar" | "floor">
              value={view}
              onChange={chooseView}
              options={[
                { value: "calendar", label: "Calendar" },
                { value: "floor", label: "Rooms" },
              ]}
            />
            <Segmented<GroupBy>
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "type", label: "Room type" },
                { value: "floor", label: "Floor" },
              ]}
            />
            {/* Was a <Button> with no onClick — it looked live and did
                nothing. The flow it needed did not exist: check-in
                assigns a room AT arrival, and nothing assigned one
                before it. */}
            <AssignRoomFlow hotelId={hotelId} />
          </div>
        </div>

        {/* Filter pills with live counts */}
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter rooms">
          {PILLS.map((p) => (
            <button
              key={p}
              type="button"
              data-filter-pill={p}
              aria-pressed={pill === p}
              onClick={() => setPill(p)}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-2xs font-medium",
                "pointer-coarse:min-h-11",
                "border transition-colors duration-150",
                pill === p
                  ? "bg-ink-900 text-white border-ink-900"
                  : "bg-white text-grey-600 border-grey-200 hover:border-grey-300 hover:text-ink-900",
              )}
            >
              {PILL_LABEL[p]}
              <span className={cn("tabular", pill === p ? "text-white/70" : "text-grey-500")}>
                {counts[p] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {stale && (
        <StaleRooms
          failure={failure}
          shownAt={shownAt}
          missingWindow={showingEarlierWindow ? start : null}
          refreshing={refreshing}
          onRetry={paused && !failure ? undefined : retry}
        />
      )}

      {/* ── The house, as a floor ───────────────────────────────────
          Today's rooms as tiles, in the POS floor's language because it
          is the same job: somebody standing up with a phone asking which
          of these is free and which needs something done to it. It
          renders the data the chart already loaded — a second query
          would be a second answer, and the two would differ on the day
          it mattered.

          The SAME filter honours it, so a pill cannot say six here and
          nine on the chart. */}
      {/* A new clerk's first jobs (Start here). Placed per view, because
          above both views it hid the thing it explains: on a phone the
          controls and five jobs are taller than the screen, and the rooms
          got 41px until "Got it".

          Rooms: INSIDE the scroll, so it scrolls away above the rooms.
          Calendar: the chart scrolls both ways and a card inside would
          scroll off sideways, so it sits above, capped at 45%. */}
      {view === "floor" ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-quiet p-1">
          <StartHere className="px-3 sm:px-4 pt-2 pb-3" />
          <HouseFloor
            groups={groups.map((g) => ({
              ...g,
              rooms: g.rooms.filter(roomVisible),
            })).filter((g) => g.rooms.length > 0)}
            businessDate={BUSINESS_DATE}
            todaysStays={todaysStays}
            onOpenStay={openStay}
            onWalkIn={(roomNumber, date) => {
              searchParams.set("res", `new:${roomNumber}:${date}`);
              setSearchParams(searchParams);
            }}
          />
        </div>
      ) : (
      <>
      <StartHere className="shrink-0 max-h-[45%] overflow-y-auto scrollbar-quiet px-4 sm:px-5 pt-3 pb-1" />
      <div className="flex-1 min-h-0 overflow-auto scrollbar-quiet">
        <div className={CHART_MIN_W}>
          {/* Date header */}
          <div className={cn("grid sticky top-0 z-30 bg-grey-50 border-b border-grey-200", GRID)}>
            <div className={cn(
              "px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-grey-500 border-r border-grey-200",
              /* The corner: pinned in both directions, so it outranks
                 the row cells that slide under it AND the date header
                 it sits inside. Opaque, or the chart shows through. */
              ROOM_COL, "z-10 bg-grey-50",
            )}>
              Room
            </div>
            {dates.map((d) => (
              <div
                key={d}
                data-date-col={d}
                className={cn(
                  "px-1 py-2 text-center border-r border-grey-200 last:border-r-0",
                  isWeekend(d) && "bg-brand-orange-50",
                  d === BUSINESS_DATE && "bg-ink-900 text-white",
                )}
              >
                <div className={cn(
                  "text-2xs font-semibold uppercase",
                  d === BUSINESS_DATE ? "text-white/70" : "text-grey-500",
                )}>
                  {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
                    weekday: "short", timeZone: "UTC",
                  })}
                </div>
                <div className={cn(
                  "text-xs font-medium tabular",
                  d === BUSINESS_DATE ? "text-white" : "text-ink-900",
                )}>
                  {d.slice(-2)}
                </div>
              </div>
            ))}
          </div>

          {/* Room type groups */}
          {groups.map((group) => {
            const isCollapsed = collapsed[group.type] ?? false;
            const visibleRooms = group.rooms.filter(roomVisible);
            if (visibleRooms.length === 0) return null;

            return (
              <div key={group.type}>
                {/* Group row — availability over rate, per date */}
                <div className={cn("grid bg-grey-100/70 border-b border-grey-200", GRID)}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [group.type]: !isCollapsed }))
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-left border-r border-grey-200",
                      "hover:bg-grey-200/50 transition-colors duration-150",
                      ROOM_COL, "z-20 bg-grey-100",
                    )}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 text-grey-500 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3.5 text-grey-500 shrink-0" />
                    )}
                    <span className="text-2xs font-semibold uppercase tracking-wide text-ink-900 truncate">
                      {group.type}
                    </span>
                    <span className="text-2xs text-grey-500 tabular ml-auto">
                      {visibleRooms.length}
                    </span>
                  </button>

                  {group.perDate.map((cell) => (
                    <div
                      key={cell.date}
                      className={cn(
                        "px-1 py-1 text-center border-r border-grey-200 last:border-r-0 leading-tight",
                        isWeekend(cell.date) && "bg-brand-orange-50/60",
                      )}
                    >
                      <div className={cn(
                        "text-2xs font-semibold tabular",
                        cell.available === 0 ? "text-brand-red" : "text-ink-900",
                      )}>
                        {cell.available}
                      </div>
                      <div className="text-2xs text-grey-500 tabular">
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
                {!isCollapsed && visibleRooms.map((room) => (
                  <div
                    key={room.number}
                    data-room-row={room.number}
                    className={cn("grid border-b border-grey-100 group", GRID)}
                  >
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 h-9 border-r border-grey-200",
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

                    {/* Empty cells — clicking one starts a booking there */}
                    {dates.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => openStay(`new:${room.number}:${d}`)}
                        aria-label={`Book room ${room.number} on ${d}`}
                        className={cn(
                          "h-9 border-r border-grey-100 last:border-r-0 transition-colors duration-150",
                          isWeekend(d) && "bg-brand-orange-50/40",
                          d === BUSINESS_DATE && "bg-ink-900/[0.03]",
                          "hover:bg-brand-orange-50",
                        )}
                        /* gridRow 1, like the bars: with a column alone,
                           auto-placement put every cell under a bar - and
                           each one after it - into a second row (FD-13). */
                        style={{ gridColumn: i + 2, gridRow: 1 }}
                      />
                    ))}

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

          {/* Pinned footer */}
          <div className={cn("grid sticky bottom-0 z-30 bg-white border-t-2 border-ink-900", GRID)}>
            <div className={cn(
              "px-2.5 py-1.5 border-r border-grey-200",
              ROOM_COL, "z-10 bg-white",
            )}>
              <div className="text-2xs font-semibold uppercase tracking-wide text-grey-500 leading-tight">
                Available
              </div>
              <div className="text-2xs text-grey-500 leading-tight">Occupancy</div>
            </div>
            {footer.map((f) => (
              <div
                key={f.date}
                className={cn(
                  "px-1 py-1.5 text-center border-r border-grey-200 last:border-r-0",
                  isWeekend(f.date) && "bg-brand-orange-50/60",
                )}
              >
                <div className="text-2xs font-semibold text-ink-900 tabular leading-tight">
                  {f.availableInventory}
                </div>
                <div className="h-1 rounded-full bg-grey-200 overflow-hidden mt-1">
                  <div
                    className="h-full bg-brand-tangerine rounded-full"
                    style={{ width: `${f.occupancyPct}%` }}
                  />
                </div>
                <div className="text-2xs text-grey-500 tabular leading-tight mt-0.5">
                  {Math.round(f.occupancyPct)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
      )}

      {/* ── Detail panel — the chart stays visible behind it ──────── */}
      <StayDrawer
        hotelId={hotelId}
        stay={selected?.stay ?? null}
        businessDate={BUSINESS_DATE}
        status={selected ? { tone: BAR_TONE[selected.tone], label: BAR_LABEL[selected.tone] } : null}
        onClose={closeStay}
      />

      {/* ── Walk-in, from an empty cell ───────────────────────────── */}
      {walkIn && (
        <WalkInFlow
          hotelId={hotelId}
          roomNumber={walkIn.roomNumber}
          date={walkIn.date}
          open
          onOpenChange={(o) => !o && closeStay()}
        />
      )}
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
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 bg-white border-b border-grey-200 px-4 sm:px-5 py-3">
        <h1 className="text-lg font-semibold text-ink-900">{title}</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-quiet">{children}</div>
    </div>
  );
}

/* SHAPED LIKE WHAT IT STANDS IN FOR. Twelve full-width bars said "a list
   is coming" over a screen that is tiles on Rooms and a fortnight grid on
   Calendar, and the swap jumped. These keep the controls' height, the
   tiles' size and the chart's columns, so the house lands where the grey
   was. */
function StayViewSkeleton({ view, title }: { view: "calendar" | "floor"; title: string }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 bg-white border-b border-grey-200 px-4 sm:px-5 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-ink-900">{title}</h1>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-60 sm:ml-auto" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PILLS.map((p) => <Skeleton key={p} className="h-7 w-20 rounded-full" />)}
        </div>
      </div>

      <div
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
        data-rooms-skeleton={view}
        className="flex-1 min-h-0 overflow-hidden"
      >
        {view === "floor" ? (
          <div className="p-1">
            <div className="flex gap-x-4 gap-y-2 flex-wrap mb-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-20" />)}
            </div>
            {[9, 8].map((tiles, s) => (
              <section key={s} className="mb-6">
                <Skeleton className="h-3 w-24 mb-2.5" />
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">
                  {Array.from({ length: tiles }).map((_, i) => (
                    <Skeleton key={i} className="min-h-[5.5rem] rounded-lg" />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={CHART_MIN_W}>
            <div className={cn("grid bg-grey-50 border-b border-grey-200", GRID)}>
              <div className="px-3 py-2 border-r border-grey-200">
                <Skeleton className="h-3 w-10" />
              </div>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1 px-1 py-2 border-r border-grey-200 last:border-r-0">
                  <Skeleton className="h-2.5 w-6" />
                  <Skeleton className="h-3 w-4" />
                </div>
              ))}
            </div>
            {Array.from({ length: 10 }).map((_, r) => (
              <div key={r} className={cn("grid border-b border-grey-100", GRID)}>
                <div className="flex items-center px-2.5 h-9 border-r border-grey-200">
                  <Skeleton className="h-3.5 w-10" />
                </div>
                <div
                  className="self-center mx-0.5"
                  style={{ gridColumn: `${2 + ((r * 5) % 9)} / span ${2 + (r % 4)}`, gridRow: 1 }}
                >
                  <Skeleton className="h-6 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
        "shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 sm:px-5 py-2.5",
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
            {bar.stay.isComplimentary ? "Complimentary" : money(bar.stay.offeredTariff)} ·
            balance {money(bar.balance)}
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
