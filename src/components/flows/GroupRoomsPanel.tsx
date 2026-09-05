import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, User, Baby, Crown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button, Dialog, DialogContent, StatusPill, Skeleton,
} from "@/components/ui";
import { getGroup, type GroupRoom } from "@/data/repositories";

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

   THE ONE YOU CAME FROM IS MARKED. Opened from a stay, this is "who
   else is in this booking" — and losing your place in a list of nine
   near-identical cards is the failure it would otherwise have.

   A ROOM NUMBER CAN BE A DASH. An unassigned booking has no room, and
   inventing one — or showing a blank that reads as a rendering fault —
   is worse than saying so.
   ══════════════════════════════════════════════════════════════════ */

const STATUS_TONE: Record<string, "success" | "info" | "neutral" | "danger"> = {
  checked_in: "success",
  confirmed: "info",
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

export function GroupRoomsPanel({
  hotelId, groupId, currentStayId, open, onOpenChange,
}: {
  hotelId: string;
  groupId: string;
  /** The room this was opened from, so somebody does not lose their
      place among nine near-identical cards. */
  currentStayId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["group", hotelId, groupId],
    queryFn: () => getGroup(hotelId, groupId),
    enabled: open,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Group reservation list"
        description={
          group
            ? `${group.name}${group.blockCode ? ` · ${group.blockCode}` : ""}`
            : "Loading…"
        }
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {group && (
              <Link to={`/h/${hotelId}/groups/${groupId}`}>
                <Button className="h-11">Open the group</Button>
              </Link>
            )}
          </>
        }
      >
        {q.isLoading ? (
          <Skeleton className="h-48" />
        ) : rooms.length === 0 ? (
          <p className="text-sm text-grey-500">
            This group has no rooms — which usually means they were all
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
      </DialogContent>
    </Dialog>
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
                   cursor-pointer rounded-md"
      >
        <Chevron className="size-4 text-grey-400" />
        <span className="text-base font-medium text-ink-900">{type}</span>
        <span className="text-sm text-grey-500">({rooms.length})</span>
      </button>

      {open && (
        <ul className="space-y-2 mt-1">
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
        className={cn(
          "block rounded-md border bg-white p-3 transition-colors",
          current
            ? /* Where you came from. Losing your place among nine
                 near-identical cards is the failure this prevents. */
              "border-brand-orange ring-1 ring-brand-orange/30"
            : "border-grey-200 hover:border-grey-300",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900 truncate">
              {room.guest}
            </p>
            <p className="text-sm tabular text-grey-500">{room.reference}</p>
          </div>
          <StatusPill tone={STATUS_TONE[room.status] ?? "neutral"}>
            {STATUS_LABEL[room.status] ?? room.status}
          </StatusPill>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-2.5">
          <div>
            <p className="text-sm text-grey-500">Room</p>
            <p className="text-base tabular font-medium text-ink-900">
              {/* A DASH. An unassigned booking has no room, and a blank
                  reads as a rendering fault. */}
              {room.room ?? <span className="text-grey-400">—</span>}
            </p>
          </div>

          <div>
            <p className="text-sm text-grey-500">Party</p>
            <p className="flex items-center gap-2.5 text-base text-ink-900">
              <span className="flex items-center gap-1">
                <User className="size-3.5 text-grey-400" />
                <span className="tabular">{room.adults}</span>
              </span>
              {/* Children are shown even at zero. On a group this is the
                  number housekeeping sets a cot from, and a missing row
                  reads as "nobody has said" rather than "none". */}
              <span className="flex items-center gap-1">
                <Baby className="size-3.5 text-grey-400" />
                <span className={cn("tabular",
                  room.children === 0 && "text-grey-400")}>
                  {room.children}
                </span>
              </span>
            </p>
          </div>

          {room.routed && (
            <div>
              <p className="text-sm text-grey-500">Billing</p>
              <p className="flex items-center gap-1.5 text-base text-ink-900">
                <Crown className="size-3.5 text-brand-orange" />
                Host pays
              </p>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
