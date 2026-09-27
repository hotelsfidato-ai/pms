import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, User, Baby, Crown } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusPill, Skeleton } from "@/components/ui";
import { getGroup, type GroupRoom } from "@/modules/reservations/data/groups";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S ROOMS, AS CARDS

   A LIST IS THE WRONG SHAPE FOR THIS. A group is read as "two Superior
   and one Deluxe", not as three rows in reference order — the person
   asking is allocating rooms, or setting beds, and the room TYPE is
   what they are grouping by in their head. A table makes them do that
   grouping themselves, every time.

   So: sections by type with a count, and a card per room carrying the
   four things somebody actually wants — who, which room, how many
   people, and what state the booking is in. PAX IS ON THE CARD because
   for a group it is the first question: nine rooms is meaningless until
   you know whether it is nine couples or nine families.

   ⚠ BESIDE THE STAY, NOT OVER IT. This was a dialog opened from the
   group pill, centred on top of the very booking it was about. The
   owner's reference on 14 September puts the group's rooms in a column
   next to the reservation, and that is the right shape: "who else is in
   this booking" is asked while looking at one, and a modal hides the
   one you are looking at. The pill now brings this column into view.

   THE ONE YOU CAME FROM IS MARKED. Losing your place in a list of nine
   near-identical cards is the failure it would otherwise have.

   A ROOM NUMBER CAN BE A DASH. An unassigned booking has no room, and
   inventing one — or showing a blank that reads as a rendering fault —
   is worse than saying so.
   ══════════════════════════════════════════════════════════════════ */

/** The id the group pill scrolls to. One stay panel is open at a time. */
export const GROUP_ROOMS_ID = "group-rooms";

/* One colour per state, everywhere (D27-48): in house blue, due in
   (confirmed, not yet arrived) orange. */
const STATUS_TONE: Record<string, "accent" | "info" | "neutral" | "danger"> = {
  checked_in: "info",
  confirmed: "accent",
  checked_out: "neutral",
  cancelled: "neutral",
  no_show: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  checked_in: "In house",
  confirmed: "Confirmed",
  checked_out: "Departed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export function GroupRoomsList({
  hotelId, groupId, currentStayId,
}: {
  hotelId: string;
  groupId: string;
  /** The room this was opened from, so somebody does not lose their
      place among nine near-identical cards. */
  currentStayId?: string;
}) {
  const q = useQuery({
    queryKey: ["group", hotelId, groupId],
    queryFn: () => getGroup(hotelId, groupId),
  });

  const group = q.data;
  const rooms = group?.rooms ?? [];

  /* Grouped by TYPE, in the order the query returns them — which 071
     orders by the room type's own sort order, so Superior comes before
     Deluxe here for the same reason it does on the tape chart. */
  const byType = new Map<string, GroupRoom[]>();
  for (const r of rooms) {
    byType.set(r.roomType, [...(byType.get(r.roomType) ?? []), r]);
  }

  return (
    <section
      id={GROUP_ROOMS_ID}
      /* Focusable so the pill can move a screen reader here as well as
         the eye. */
      tabIndex={-1}
      aria-labelledby={`${GROUP_ROOMS_ID}-title`}
      className="outline-none scroll-mt-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id={`${GROUP_ROOMS_ID}-title`}
          className="text-md font-semibold text-ink-900"
        >
          Group reservation list
        </h3>
        {group && (
          <Link
            to={`/h/${hotelId}/groups/${groupId}`}
            className="text-sm font-medium text-brand-orange-700 hover:underline
                       underline-offset-4 shrink-0"
          >
            Open the group
          </Link>
        )}
      </div>
      <p className="text-sm text-grey-600 mt-0.5">
        {group
          ? `${group.name}${group.blockCode ? ` · ${group.blockCode}` : ""}`
          : "Loading…"}
      </p>

      <div className="mt-4">
        {q.isLoading ? (
          <Skeleton className="h-48" />
        ) : rooms.length === 0 ? (
          <p className="text-sm text-grey-600">
            This group has no rooms - which usually means they were all
            cancelled.
          </p>
        ) : (
          <div className="space-y-4">
            {[...byType.entries()].map(([type, list]) => (
              <TypeSection
                key={type}
                type={type}
                rooms={list}
                hotelId={hotelId}
                currentStayId={currentStayId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TypeSection({ type, rooms, hotelId, currentStayId }: {
  type: string; rooms: GroupRoom[]; hotelId: string;
  currentStayId?: string;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 min-h-11 w-full text-left
                   cursor-pointer rounded-md focus-visible:outline-2
                   focus-visible:outline-brand-orange"
      >
        <Chevron className="size-4 text-grey-500" />
        <span className="text-base font-semibold text-ink-900">{type}</span>
        <span className="text-sm text-grey-600 tabular">({rooms.length})</span>
      </button>

      {open && (
        <ul className="space-y-2">
          {rooms.map((r) => (
            <RoomCard key={r.reservationId} room={r} hotelId={hotelId}
                      current={r.reservationId === currentStayId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomCard({ room, hotelId, current }: {
  room: GroupRoom; hotelId: string; current: boolean;
}) {
  return (
    <li>
      <Link
        to={`/h/${hotelId}/stay?res=${room.reservationId}`}
        aria-current={current ? "true" : undefined}
        className={cn(
          "block rounded-lg border bg-white p-3.5 transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-brand-orange",
          current
            ? /* Where you came from. Losing your place among nine
                 near-identical cards is the failure this prevents. */
              "border-brand-orange ring-1 ring-brand-orange/30"
            : "border-grey-200 hover:border-grey-400",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink-900 truncate">
              {room.guest}
            </p>
            <p className="text-sm tabular text-grey-600">{room.reference}</p>
          </div>
          <span className="flex items-center gap-2 shrink-0">
            <StatusPill tone={STATUS_TONE[room.status] ?? "neutral"}>
              {STATUS_LABEL[room.status] ?? room.status}
            </StatusPill>
            {/* It opens the stay: an arrow says so (the Tappable Rule). */}
            <ChevronRight className="size-4 text-grey-400" aria-hidden />
          </span>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3">
          <div>
            <p className="text-xs font-medium text-grey-500">Room</p>
            <p className="text-base tabular font-semibold text-ink-900">
              {/* A DASH. An unassigned booking has no room, and a blank
                  reads as a rendering fault. */}
              {room.room ?? <span className="text-grey-500">-</span>}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-grey-500">Guests</p>
            <p className="flex items-center gap-2.5 text-base text-ink-900">
              <span className="flex items-center gap-1" aria-label={`${room.adults} adults`}>
                <User className="size-3.5 text-grey-500" aria-hidden />
                <span className="tabular font-semibold">{room.adults}</span>
              </span>
              {/* Children are shown even at zero. On a group this is the
                  number housekeeping sets a cot from, and a missing row
                  reads as "nobody has said" rather than "none". */}
              <span className="flex items-center gap-1" aria-label={`${room.children} children`}>
                <Baby className="size-3.5 text-grey-500" aria-hidden />
                <span className={cn("tabular font-semibold",
                  room.children === 0 && "text-grey-500")}>
                  {room.children}
                </span>
              </span>
            </p>
          </div>

          {room.routed && (
            <div>
              <p className="text-xs font-medium text-grey-500">Billing</p>
              <p className="flex items-center gap-1.5 text-base text-ink-900">
                <Crown className="size-3.5 text-brand-orange" aria-hidden />
                Host pays
              </p>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
