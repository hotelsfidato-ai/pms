import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import type { ChartRoom, ChartRoomType, Stay } from "@/data/repositories";

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

const TILE: Record<RoomState, string> = {
  free:             "bg-white border-grey-300 hover:border-grey-400",
  occupied:         "bg-info-50 border-info",
  arriving:         "bg-orange-50 border-brand-orange",
  "due-out":        "bg-yellow-50 border-brand-yellow",
  dirty:            "bg-red-50 border-brand-red/40",
  "out-of-service": "bg-grey-100 border-grey-300",
};

const LABEL: Record<RoomState, string> = {
  free:             "Free",
  occupied:         "In house",
  arriving:         "Arriving",
  "due-out":        "Due out",
  dirty:            "Needs cleaning",
  "out-of-service": "Out of service",
};

export const HOUSE_LEGEND: { state: RoomState; label: string }[] = [
  { state: "free", label: "Free" },
  { state: "arriving", label: "Arriving" },
  { state: "occupied", label: "In house" },
  { state: "due-out", label: "Due out" },
  { state: "dirty", label: "Needs cleaning" },
  { state: "out-of-service", label: "Out of service" },
];

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
      empty cell on the chart does. */
  onWalkIn: (roomNumber: string, date: string) => void;
}) {
  return (
    <div>
      <div className="flex gap-x-4 gap-y-2 flex-wrap mb-4">
        {HOUSE_LEGEND.map((l) => (
          <span key={l.state}
                className="flex items-center gap-2 text-sm text-grey-600">
            <i className={cn("size-3.5 rounded border", TILE[l.state])} />
            {l.label}
          </span>
        ))}
      </div>

      {groups.map((group) => (
        <section key={group.type} className="mb-6">
          <h2 className="text-2xs font-semibold uppercase tracking-wide
                         text-grey-400 mb-2.5">
            {group.type}
            <span className="ml-1.5 tabular font-normal text-grey-400">
              {group.rooms.length}
            </span>
          </h2>

          {/* auto-fill from 7rem: three across on a phone, and as many as
              fit on a desk. No breakpoint to get wrong, and no horizontal
              scroll on any width — which is the failure the tape chart
              has on a phone and the reason this exists. */}
          <div className="grid gap-2
                          [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">
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
  onWalkIn: (roomNumber: string, date: string) => void;
}) {
  const state = stateOf(room);

  const act = () => {
    if (stay) return onOpenStay(stay.id);
    if (state === "out-of-service") return;
    onWalkIn(room.number, businessDate);
  };

  return (
    <button
      type="button"
      data-room-tile={room.number}
      onClick={act}
      disabled={state === "out-of-service"}
      className={cn(
        "rounded-lg border p-2.5 text-left w-full",
        /* 5.5rem, so three tiles and their labels fit above the fold on
           a phone. Tall enough for a name to wrap once. */
        "min-h-[5.5rem] flex flex-col",
        "transition-colors duration-200",
        state === "out-of-service" ? "cursor-not-allowed" : "cursor-pointer",
        TILE[state],
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-lg tabular font-semibold text-ink-900">
          {room.number}
        </span>
        {/* The mark housekeeping acts on, on the tile itself. A clean
            room and a dirty one look identical otherwise, and the whole
            point of walking the floor with this is to see which. */}
        {room.state.dirty && state !== "dirty" && (
          <span className="text-2xs font-semibold uppercase tracking-wide
                           text-brand-red">
            dirty
          </span>
        )}
      </div>

      <p className="text-2xs uppercase tracking-wide text-grey-400">
        {LABEL[state]}
      </p>

      {stay ? (
        <>
          {/* Marked, so a test can assert the invariant structurally.
              Matching on TEXT was too weak: textContent concatenates
              without spaces, "Kalyani Rege" + "to 25 Aug" becomes
              "Regeto 25 Aug", and the word boundary the assertion
              relied on was not there. The test passed with the bug
              reintroduced. */}
          <p data-tile-guest
             className="text-sm text-ink-900 mt-1 leading-tight line-clamp-2">
            {stay.guest}
          </p>
          <p className="text-2xs text-grey-500 tabular mt-auto pt-1">
            {state === "due-out"
              ? "out today"
              : `to ${dateShort(stay.departure)}`}
          </p>
        </>
      ) : (
        <p className="text-2xs text-grey-400 mt-auto pt-1">
          {state === "out-of-service" ? "—" : room.type}
        </p>
      )}
    </button>
  );
}
