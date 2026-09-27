import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import type { ChartRoom, ChartRoomType } from "@/modules/front-desk/data/stayview";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE HOUSE, AS A FLOOR

   The tape chart is right at a desk: fourteen columns, a fortnight of
   inventory, and a person planning next week. It is WRONG on a phone
   and wrong when the question is "what is happening now" — eighteen
   rooms times fourteen days is two hundred and fifty cells to answer
   something about one of them.

   So this is the same house as tiles, for today. It is deliberately the
   POS floor's language, because it is the same job: a person standing
   up, holding a phone, asking which of these is free and which needs
   something done to it. Somebody who has learned one screen has learned
   both.

   EVERY TILE ANSWERS THREE THINGS at a glance, which is all anybody
   reads while walking:

     is it free           the colour
     who is in it         the name
     what happens today   arriving, leaving, needs cleaning

   THE COLOUR IS DERIVED, never stored. It comes from `room.state`,
   which is the same field the filter pills count — so a tile can never
   disagree with the pill that filtered to it.

   NOTHING NEW IS FETCHED. This renders the data the chart already
   loaded. A second query would be a second answer, and the two would
   differ on the day it mattered.
   ══════════════════════════════════════════════════════════════════ */

type RoomState =
  | "out-of-service" | "due-out" | "occupied" | "arriving" | "dirty" | "free";

/** ORDER MATTERS, and it is the order a person cares in. A room that is
    occupied AND due out today is a departure — that is the thing
    somebody has to act on, and "occupied" would bury it. */
function stateOf(room: ChartRoom): RoomState {
  if (room.outOfService) return "out-of-service";
  if (room.state.dueOut) return "due-out";
  if (room.state.occupied) return "occupied";
  if (room.state.arriving) return "arriving";
  if (room.state.dirty) return "dirty";
  return "free";
}


/* 27 September, the Fidato look (the owner's approved Rooms): a tinted
   tile for a room with somebody or something in it, white for a free one,
   the state as a pill on the number's line. No legend: the filter tiles
   above carry the same words with the same colours. */
const TILE: Record<RoomState, string> = {
  free:             "bg-white ring-grey-200 hover:ring-grey-400",
  occupied:         "bg-info-50 ring-info-100 hover:ring-info",
  arriving:         "bg-brand-orange-50 ring-brand-orange-100 hover:ring-brand-orange",
  "due-out":        "bg-brand-yellow-50 ring-brand-yellow-100 hover:ring-brand-yellow",
  dirty:            "bg-brand-red-50 ring-brand-red-100 hover:ring-brand-red",
  "out-of-service": "bg-grey-100 ring-grey-200",
};

/* The pill's ink: the readable step of each state's colour. */
const PILL: Record<RoomState, string> = {
  free:             "",
  occupied:         "text-info ring-info-100",
  arriving:         "text-brand-orange-700 ring-brand-orange-100",
  "due-out":        "text-brand-yellow-800 ring-brand-yellow-100",
  dirty:            "text-brand-red-700 ring-brand-red-100",
  "out-of-service": "text-grey-600 ring-grey-200",
};

const LABEL: Record<RoomState, string> = {
  free:             "Free",
  occupied:         "In house",
  arriving:         "Arriving",
  "due-out":        "Due out",
  dirty:            "Needs cleaning",
  "out-of-service": "Out of service",
};

export function HouseFloor({
  groups, businessDate, todaysStays, onOpenStay, onWalkIn,
}: {
  groups: ChartRoomType[];
  businessDate: string;
  /* WHO IS IN EACH ROOM TODAY, keyed by room number.

     ⚠ THIS USED TO READ `room.bars`, and bars belong to the CHART'S
     WINDOW rather than to today. A guest who arrived on the 4th and
     departs on the 5th occupies the night of the 4th — so with the
     window starting on the 5th their bar is behind it entirely, and
     room 202 read "DUE OUT" with no name under it while somebody was
     still standing in it.

     Page the chart to next week and it would have been worse: today's
     state beside next week's names. The state was always
     business-date-based and window-independent; the name has to be
     too. */
  todaysStays: Map<string, Stay>;
  onOpenStay: (stayId: string) => void;
  /** A free room, tapped, starts a walk-in into it — the same thing an
      empty cell on the chart does. Absent for somebody who may not take
      one (D24-27): the free tile is then not a button at all. */
  onWalkIn?: (roomNumber: string, date: string) => void;
}) {
  return (
    <div className="grid gap-6">
      {groups.map((group) => (
        <section key={group.type}>
          <h2 className="flex items-center gap-2 mb-3 text-md font-semibold text-ink-900">
            {group.type}
            <span className="h-5 px-2 rounded-full bg-grey-100 text-grey-600 text-xs font-semibold leading-5 tabular">
              {group.rooms.length}
            </span>
          </h2>

          {/* Five across on a desk, four below 1280, two on a phone, where
              an odd last tile takes the row so none sits alone. Each tile's
              three lines (number, who, when) are levelled across its row. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-2.5">
            {group.rooms.map((room) => (
              <RoomTile
                key={room.number}
                room={room}
                businessDate={businessDate}
                stay={todaysStays.get(room.number)}
                onOpenStay={onOpenStay}
                onWalkIn={onWalkIn}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RoomTile({ room, businessDate, stay, onOpenStay, onWalkIn }: {
  room: ChartRoom;
  businessDate: string;
  stay: Stay | undefined;
  onOpenStay: (stayId: string) => void;
  onWalkIn?: (roomNumber: string, date: string) => void;
}) {
  const state = stateOf(room);

  const act = () => {
    if (stay) return onOpenStay(stay.id);
    if (state === "out-of-service") return;
    onWalkIn?.(room.number, businessDate);
  };

  /* Nothing to open and no walk-in to take: the tile only shows the room
     (D24-27), so it is not a control. */
  const Tile = !stay && !onWalkIn && state !== "out-of-service" ? "div" : "button";
  const free = state === "free";

  return (
    <Tile
      {...(Tile === "button"
        ? { type: "button" as const, onClick: act, disabled: state === "out-of-service" }
        : {})}
      data-room-tile={room.number}
      className={cn(
        "row-span-3 grid grid-rows-subgrid gap-y-0.5 rounded-lg ring-1 ring-inset px-3.5 py-3 text-left w-full min-w-0",
        "max-sm:[&:last-child:nth-child(odd)]:col-span-2",
        Tile === "div" ? "" : state === "out-of-service" ? "cursor-not-allowed" : "cursor-pointer press-tile",
        TILE[state],
      )}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className={cn("text-xl tabular tracking-[-0.02em]", free ? "font-medium text-grey-700" : "font-semibold text-ink-900")}>
          {room.number}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          {/* The mark housekeeping acts on, on the tile itself. A clean
              room and a dirty one look identical otherwise, and the whole
              point of walking the floor with this is to see which. */}
          {room.state.dirty && state !== "dirty" && (
            <span className="text-xs font-semibold text-brand-red-700">dirty</span>
          )}
          {/* grey-600 at the least on a tint: the state is the most
              important word on the tile. */}
          <span className={cn(
            "inline-flex items-center gap-1.5 h-[21px] rounded-full text-xs font-medium whitespace-nowrap",
            free ? "text-grey-500" : cn("px-2 bg-white", PILL[state]),
          )}>
            {!free && <i className="size-1.5 rounded-full bg-current" aria-hidden />}
            {LABEL[state]}
          </span>
        </span>
      </div>

      {stay ? (
        <>
          {/* Marked, so a test can assert the invariant structurally.
              Matching on TEXT was too weak: textContent concatenates
              without spaces, "Kalyani Rege" + "to 25 Aug" becomes
              "Regeto 25 Aug", and the word boundary the assertion
              relied on was not there. The test passed with the bug
              reintroduced. */}
          <p data-tile-guest className="mt-1 text-sm font-medium text-ink-900 leading-5 truncate">
            {stay.guest}
          </p>
          <p className={cn(
            "text-xs font-medium tabular",
            state === "due-out" ? "text-brand-yellow-800" : "text-grey-600",
          )}>
            {state === "due-out"
              ? "out today"
              : `to ${dateShort(stay.departure)}`}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm leading-5 text-grey-500 truncate">
            {state === "out-of-service" ? "-" : room.type}
          </p>
          <span aria-hidden />
        </>
      )}
    </Tile>
  );
}
