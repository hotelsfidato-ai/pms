import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  ChevronDown, ChevronRight, ChevronLeft, Globe, User, Building2,
  Sparkle, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { AssignRoomFlow } from "@/components/flows/AssignRoomFlow";
import {
  Page, Button, Segmented, Tooltip, StatusPill,
  Drawer, DrawerContent, Skeleton, DetailList, DetailRow, Tabs, TabsList,
  TabsTrigger, TabsContent, toast,
} from "@/components/ui";
import { CheckInFlow } from "@/components/flows/CheckInFlow";
import { VoidFlow } from "@/components/flows/VoidFlow";
import { MoveRoomFlow } from "@/components/flows/MoveRoomFlow";
import { AmendStayFlow } from "@/components/flows/AmendStayFlow";
import { FolioPanel } from "@/components/flows/FolioPanel";
import { WalkInFlow } from "@/components/flows/WalkInFlow";
import {
  getStayView, getStay, queryKeys, BUSINESS_DATE, addDays, isWeekend,
  setGuestVip,
  type ChartBar, type ChartRoom, type BarTone, type Stay,
} from "@/data/repositories";

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
  tentative: "bg-brand-yellow text-ink-900",
  "due-out": "bg-brand-tangerine text-white",
  "no-show": "bg-brand-rose text-white",
  void: "bg-brand-red/25 text-brand-red line-through",
};

const BAR_LABEL: Record<BarTone, string> = {
  "in-house": "In house",
  confirmed: "Confirmed",
  tentative: "Tentative",
  "due-out": "Due out",
  "no-show": "No show",
  void: "Void",
};

const PILLS = ["All", "Vacant", "Occupied", "Arrivals", "Reserved", "Blocked", "Due Out", "Dirty"] as const;
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

export default function StayViewPage() {
  const params = useParams();
  const fallbackHotel = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallbackHotel;

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("res");

  /* Open on the business date so the chart shows today first. */
  const [start, setStart] = useState(BUSINESS_DATE);
  const [pill, setPill] = useState<Pill>("All");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.stayView(hotelId, start, BUSINESS_DATE),
    queryFn: () => getStayView(hotelId, start, BUSINESS_DATE),
  });

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

  if (isLoading || !data) {
    return (
      <Page>
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Page>
    );
  }

  const { dates, roomTypes, footer, counts } = data;

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
    if (room.outOfService) return false;
    switch (pill) {
      case "Vacant": return !room.state.occupied;
      case "Occupied": return room.state.occupied;
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
          <div className="flex items-center gap-1">
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

          <div className="ml-auto flex items-center gap-2">
            {/* This was `value="Room type"` with `onChange={() => undefined}`
                — a toggle offering a view it could not produce. Every room
                already carries its floor, so grouping by it costs nothing
                but was never wired. */}
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
              {p}
              <span className={cn("tabular", pill === p ? "text-white/70" : "text-grey-400")}>
                {counts[p] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── The chart ────────────────────────────────────────────── */}
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
                  d === BUSINESS_DATE ? "text-white/70" : "text-grey-400",
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
                          ? "—"
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
                        style={{ gridColumn: i + 2 }}
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
              <div className="text-2xs text-grey-400 leading-tight">Occupancy</div>
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

      {/* ── Detail panel — the chart stays visible behind it ──────── */}
      <Drawer open={!!selected} onOpenChange={(open) => !open && closeStay()}>
        {selected && (
          <DrawerContent
            title={selected.stay.guest}
            description={`Room ${selected.stay.roomNumber} · ${selected.stay.reference}`}
            width="lg"
          >
            <Tabs defaultValue="stay">
              <TabsList>
                <TabsTrigger value="stay">Stay</TabsTrigger>
                <TabsTrigger value="folio">Folio</TabsTrigger>
              </TabsList>
              <TabsContent value="stay">
                <div className="space-y-5 pt-1">
                  <StayDetail bar={selected} />
                  {selected.stay.status === "due-in" && (
                    <>
                      <CheckInFlow
                        hotelId={hotelId}
                        stay={selected.stay}
                        businessDate={BUSINESS_DATE}
                      />
                      {/* Only before arrival. A guest who checked in cannot
                          un-arrive, and the server refuses it anyway — but
                          offering a button that always fails is worse than
                          not offering it. */}
                      <VoidFlow hotelId={hotelId} stay={selected.stay} />
                    </>
                  )}
                  {/* A move needs somebody to be IN a room, so it appears
                      once they have arrived and until they leave. Before
                      arrival the room is changed by assigning a different
                      one, which is a different act and already has its
                      own button on the chart. */}
                  {(selected.stay.status === "in-house"
                    || selected.stay.status === "due-out") && (
                    <MoveRoomFlow hotelId={hotelId} stay={selected.stay}
                                  businessDate={BUSINESS_DATE} />
                  )}
                  {/* Dates and party size, for anything not yet over. The
                      server refuses a departed or cancelled booking and says
                      why, but offering a button that always fails is worse
                      than not offering it. */}
                  {(selected.stay.status === "due-in"
                    || selected.stay.status === "in-house"
                    || selected.stay.status === "due-out") && (
                    <AmendStayFlow hotelId={hotelId} stay={selected.stay} />
                  )}
                </div>
              </TabsContent>
              <TabsContent value="folio">
                <div className="pt-1">
                  <FolioPanel
                    hotelId={hotelId}
                    stay={selected.stay}
                    businessDate={BUSINESS_DATE}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </DrawerContent>
        )}
      </Drawer>

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

function BookingBar({ bar, onOpen }: { bar: ChartBar; onOpen: () => void }) {
  const Icon = SOURCE_ICON[bar.stay.source] ?? Globe;
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

/* ── Marking a VIP ────────────────────────────────────────────────
   Not a switch in a settings panel. The moment somebody knows is the
   moment they are looking at the booking, and a mark that needs a
   different screen is a mark nobody makes. */
function VipToggle({ stay }: { stay: Stay }) {
  const params = useParams();
  const fallbackHotel = useUi((st) => st.hotelId);
  const hotelId = params.code ?? fallbackHotel;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!stay.guestId) return;
    setBusy(true);
    const result = await setGuestVip(hotelId, stay.guestId, !stay.isVip);
    setBusy(false);
    if (!result.ok) return toast.error("Not changed", result.reason);
    toast.success(
      stay.isVip ? "No longer marked VIP" : "Marked VIP",
      `${result.guest} — this holds for their next visit too.`);
    void queryClient.invalidateQueries();
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={stay.isVip}
      className="text-xs text-grey-500 hover:text-ink-900 underline
                 cursor-pointer disabled:opacity-50"
    >
      {stay.isVip ? "Remove VIP" : "Mark VIP"}
    </button>
  );
}

function StayDetail({ bar }: { bar: ChartBar }) {
  const s: Stay = bar.stay;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill
          tone={
            bar.tone === "in-house" ? "success"
            : bar.tone === "confirmed" ? "info"
            : bar.tone === "due-out" ? "warning"
            : bar.tone === "no-show" ? "danger"
            : bar.tone === "void" ? "danger"
            : "warning"
          }
          dot
        >
          {BAR_LABEL[bar.tone]}
        </StatusPill>
        {s.isComplimentary && <StatusPill tone="accent">Complimentary</StatusPill>}
        {s.isDayUse && <StatusPill tone="neutral">Day use</StatusPill>}
        {s.groupId && <StatusPill tone="accent">Group</StatusPill>}
        {/* The two marks a clerk acts on before the guest reaches the
            desk: the room is checked ahead of a VIP, and a woman
            travelling alone is placed away from stairwells and service
            corridors. Neither is read out at the counter. */}
        {s.isVip && <StatusPill tone="accent">VIP</StatusPill>}
        {s.isSingleLady && (
          <StatusPill tone="info">Single lady — placement</StatusPill>
        )}
        {/* Readable since 043 and writable by nothing until now, which is
            half a feature with the visible half being the wrong half: a
            clerk could see the mark and never make one. It sets the flag
            on the GUEST, so it holds for their next visit too. */}
        {s.guestId && <VipToggle stay={s} />}
      </div>

      <DetailList>
        <DetailRow label="Reference"><span className="tabular">{s.reference}</span></DetailRow>
        <DetailRow label="Room">{s.roomNumber} · {s.roomType}</DetailRow>
        <DetailRow label="Arrival"><span className="tabular">{dateShort(s.arrival)}</span></DetailRow>
        <DetailRow label="Departure"><span className="tabular">{dateShort(s.departure)}</span></DetailRow>
        <DetailRow label="Nights"><span className="tabular">{s.isDayUse ? "Day use" : s.nights}</span></DetailRow>
        <DetailRow label="Party"><span className="tabular">{s.adults} adult{s.adults === 1 ? "" : "s"}{s.children ? `, ${s.children} child` : ""}</span></DetailRow>
        <DetailRow label="Source">{s.source}</DetailRow>
        {/* A dash, never a guess. An invented segment becomes a line in
            a source-mix report an owner sets policy from. */}
        <DetailRow label="Segment">{s.marketSegment ?? "—"}</DetailRow>
        <DetailRow label="Business source">{s.businessSource ?? "—"}</DetailRow>
        {s.salesPerson && (
          <DetailRow label="Sold by">{s.salesPerson}</DetailRow>
        )}
        <DetailRow label="Rate plan">{s.ratePlan}</DetailRow>
        <DetailRow label="Rack rate"><span className="tabular">{money(s.rackTariff)}</span></DetailRow>
        <DetailRow label="Offered">
          <span className="tabular">{s.isComplimentary ? "Complimentary" : money(s.offeredTariff)}</span>
        </DetailRow>
        <DetailRow label="Balance">
          <span className={cn("tabular font-medium", bar.balance < 0 ? "text-info" : bar.balance > 0 ? "text-brand-red" : "text-success")}>
            {money(bar.balance)}
            {bar.balance < 0 && <span className="ml-1.5 text-2xs font-normal text-grey-500">overpaid</span>}
          </span>
        </DetailRow>
      </DetailList>

      {s.voidReason && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-brand-red mb-1">
            Voided
          </p>
          <p className="text-sm text-grey-700 leading-relaxed">
            {s.voidReason} — this booking is on the record as never having
            happened, and is left out of revenue and cancellation figures alike.
          </p>
        </div>
      )}

      {s.notes && (
        <div className="rounded-md bg-grey-50 border border-grey-200 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-grey-400 mb-1">Note</p>
          <p className="text-sm text-grey-700 leading-relaxed">{s.notes}</p>
        </div>
      )}

      <p className="text-xs text-grey-500 leading-relaxed">
        Check-in, folio and settlement arrive at Checkpoint 5.
      </p>
    </div>
  );
}
