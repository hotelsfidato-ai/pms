import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateLong } from "@/lib/format";
import {
  Button, Dialog, DialogTrigger, DialogContent,
  StatusPill, toast,
} from "@/components/ui";
import { listStays } from "@/modules/front-desk/data/stays";
import { listAllRooms, BUSINESS_DATE, type Stay, type Room } from "@/data/repositories";
import { assignRoom } from "@/modules/front-desk/data/operations";

/* ══════════════════════════════════════════════════════════════════
   ASSIGN A ROOM

   The tape chart's "Assign room" button had no onClick. Not a stub, not
   a placeholder — a button that looked live and did nothing, in the
   header of the screen a clerk reads most.

   WHAT IT DOES THAT CHECK-IN DOES NOT

   CheckInFlow gives a guest a room AT arrival. This gives one the night
   before: a confirmed booking that has a room TYPE and no room number.
   A property that pre-allocates its arrivals could not, because the
   only path to a room assignment ran through checking somebody in.

   THE REFUSALS ARE THE POINT

   A room taken for part of the stay, a room out of service, a guest who
   already has one — each comes back with its reason and the clerk picks
   again. The EXCLUDE constraint on room_assignments is what actually
   guarantees no double-booking; this turns its error into a sentence.
   ══════════════════════════════════════════════════════════════════ */

export function AssignRoomFlow({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stayId, setStayId] = useState("");
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState(false);

  const stays = useQuery({
    queryKey: ["stays", hotelId],
    queryFn: () => listStays(hotelId),
    enabled: open,
  });
  const rooms = useQuery({
    queryKey: ["rooms", hotelId],
    queryFn: () => listAllRooms(hotelId),
    enabled: open,
  });

  /* A booking with no room number is one nobody has placed yet. The
     API answers `roomNumber: ""` for exactly that. */
  const unassigned = (stays.data ?? []).filter(
    (s: Stay) =>
      /* "due-in" is the status for a booking that has not arrived. The
         first version also tested "confirmed", which is not in this
         union at all — the API maps it before the interface sees it. */
      !s.roomNumber && s.status === "due-in",
  );

  const chosen = unassigned.find((s) => s.id === stayId) ?? null;

  /* Rooms that are free of a guest right now. The server refuses a
     genuine clash on the stay's own dates — this list is the courtesy
     that stops the clerk finding out the hard way. */
  const taken = new Set(
    (stays.data ?? [])
      .filter((s) => s.status === "in-house" || s.status === "due-out")
      .map((s) => s.roomNumber),
  );
  const available = (rooms.data ?? []).filter(
    (r: Room) => r.status !== "out-of-service" && !taken.has(r.number),
  );

  const reset = () => { setStayId(""); setRoom(""); };

  const submit = async () => {
    if (!chosen || !room) return;
    setBusy(true);
    const res = await assignRoom(hotelId, chosen.id, room);
    setBusy(false);

    if (!res.ok) return toast.error("Not assigned", res.reason);

    toast.success(
      `${res.guest} is in room ${res.room}`,
      /* Said out loud, because an upgrade nobody mentioned is an
         upgrade nobody charged for. */
      res.typeChanged
        ? `Note: ${res.typeName} is not the room type they booked.`
        : undefined,
    );
    void qc.invalidateQueries();
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus className="size-4" />
          Assign room
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Assign a room"
        description={`Give an arriving booking a room before they get here. As of ${dateLong(BUSINESS_DATE)}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary"
              loading={busy}
              disabled={!chosen || !room}
              onClick={() => void submit()}
            >
              <BedDouble className="size-4" />
              Assign the room
            </Button>
          </>
        }
      >
        {stays.isLoading || rooms.isLoading ? (
          <p className="text-base text-grey-500 py-6 text-center">Loading…</p>
        ) : unassigned.length === 0 ? (
          <div className="text-center py-8">
            <BedDouble className="size-6 text-grey-300 mx-auto mb-3" />
            <p className="text-md font-semibold text-ink-900">
              Every arrival has a room
            </p>
            <p className="text-base text-grey-500 mt-1.5 max-w-sm mx-auto">
              Nothing is waiting to be placed. A booking appears here when it
              is confirmed and has a room type but no room number.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
                Waiting for a room · {unassigned.length}
              </p>
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {unassigned.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStayId(s.id)}
                      className={cn(
                        "w-full text-left rounded-md border p-3 min-h-14",
                        "transition-colors duration-150",
                        s.id === stayId
                          ? "border-brand-orange bg-brand-orange-50"
                          : "border-grey-200 bg-white hover:border-grey-300",
                      )}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-medium text-ink-900">
                          {s.guest}
                        </span>
                        <StatusPill tone="neutral">{s.roomType}</StatusPill>
                      </div>
                      <p className="text-2xs text-grey-500 tabular mt-0.5">
                        {dateLong(s.arrival)} → {dateLong(s.departure)}
                        {s.reference && ` · ${s.reference}`}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {chosen && (
              <label className="block">
                <span className="block text-2xs uppercase tracking-wide text-grey-500 mb-1">
                  Room
                </span>
                <select
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full h-11 px-3 rounded-md border border-grey-300 text-base"
                >
                  <option value="">Choose a room…</option>
                  {available.map((r) => (
                    <option key={r.number} value={r.number}>
                      {r.number} · {r.type}
                      {r.rackRate === null ? "" : ` · ${money(r.rackRate)}`}
                      {r.type !== chosen.roomType ? "  (different type)" : ""}
                    </option>
                  ))}
                </select>
                {/* The guest booked a type. Putting them in another one is
                    allowed and worth saying before it happens, not after. */}
                <span className="block text-2xs text-grey-500 mt-1 leading-relaxed">
                  {chosen.guest} booked a {chosen.roomType}. Another type is
                  allowed — it will be noted on the assignment.
                </span>
              </label>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
