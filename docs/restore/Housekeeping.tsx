import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Check, CloudOff, RefreshCw, Sparkle, Wrench, BedDouble } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, StatusPill, Button, toast } from "@/components/ui";
import {
  listHousekeeping, markRoom, BUSINESS_DATE, type HousekeepingRoom,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   FLOW E — housekeeping, on a phone

   Designed for a phone held one-handed in a stairwell. Tap targets,
   not mouse targets: every control is at least 44px.

   An offline change QUEUES VISIBLY. A housekeeper needs to know their
   work was recorded even when the signal has gone — an action that
   silently does nothing is worse than one that refuses.
   ══════════════════════════════════════════════════════════════════ */

const GROUPS = [
  { key: "dirty", label: "Vacant dirty", tone: "warning" as const },
  { key: "clean", label: "Vacant clean", tone: "info" as const },
  { key: "inspected", label: "Inspected", tone: "success" as const },
  { key: "occupied", label: "Occupied", tone: "neutral" as const },
  { key: "out-of-service", label: "Out of order", tone: "danger" as const },
];

interface QueuedChange {
  id: number;
  roomNumber: string;
  state: "clean" | "inspected";
}

export default function HousekeepingPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const qc = useQueryClient();

  /* Simulated connectivity. Real offline sync is Stage 6; what this
     proves now is that the interface tells the truth about it. */
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [seq, setSeq] = useState(0);

  const rooms = useQuery({
    queryKey: ["housekeeping", hotelId, BUSINESS_DATE],
    queryFn: () => listHousekeeping(hotelId, BUSINESS_DATE),
  });

  /* When signal returns, the queue drains in the order it was made. */
  useEffect(() => {
    if (!online || queue.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const change of queue) {
        if (cancelled) return;
        await markRoom(hotelId, change.roomNumber, change.state);
      }
      if (cancelled) return;
      setQueue([]);
      qc.invalidateQueries();
      toast.success(`${queue.length} change${queue.length === 1 ? "" : "s"} synced`);
    })();
    return () => { cancelled = true; };
  }, [online, queue, hotelId, qc]);

  const apply = async (room: HousekeepingRoom, state: "clean" | "inspected") => {
    if (!online) {
      setSeq((n) => n + 1);
      setQueue((q) => [...q, { id: seq, roomNumber: room.number, state }]);
      toast.warning("Saved offline", `Room ${room.number} will sync when signal returns.`);
      return;
    }
    const res = await markRoom(hotelId, room.number, state);
    if (res.ok) {
      qc.invalidateQueries();
    } else {
      toast.error("Could not update", res.reason);
    }
  };

  const all = rooms.data ?? [];
  const bucket = (key: string) =>
    key === "occupied"
      ? all.filter((r) => r.occupied && r.housekeeping !== "out-of-service")
      : all.filter((r) => !r.occupied && r.housekeeping === key);

  const queuedFor = (number: string) => queue.filter((q) => q.roomNumber === number);

  return (
    <Page className="max-w-2xl">
      <PageHeader
        title="Housekeeping"
        description="Tap a room to move it on. Clean, then inspected."
      />

      {/* Connectivity — a real board would read navigator.onLine */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-md border p-3 mb-5",
          online ? "border-grey-200 bg-white" : "border-brand-yellow-100 bg-brand-yellow-50",
        )}
      >
        {online ? (
          <RefreshCw className="size-4 text-success shrink-0" />
        ) : (
          <CloudOff className="size-4 text-brand-yellow shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink-900">
            {online ? "Online" : "Offline"}
          </p>
          {queue.length > 0 && (
            <p className="text-sm text-[#8a6300] tabular" data-queue-count>
              {queue.length} change{queue.length === 1 ? "" : "s"} waiting to sync
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOnline((v) => !v)}>
          {online ? "Simulate offline" : "Reconnect"}
        </Button>
      </div>

      <div className="space-y-6">
        {GROUPS.map((group) => {
          const list = bucket(group.key);
          if (list.length === 0) return null;
          return (
            <section key={group.key} data-hk-group={group.key}>
              <div className="flex items-center gap-2 mb-2.5">
                <h2 className="text-md font-semibold text-ink-900">{group.label}</h2>
                <StatusPill tone={group.tone}>{list.length}</StatusPill>
              </div>

              <ul className="space-y-2">
                {list.map((room) => (
                  <li key={room.number}>
                    <RoomCard
                      room={room}
                      queued={queuedFor(room.number)}
                      onMark={(state) => apply(room, state)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Page>
  );
}

function RoomCard({
  room, queued, onMark,
}: {
  room: HousekeepingRoom;
  queued: QueuedChange[];
  onMark: (state: "clean" | "inspected") => void;
}) {
  const pending = queued.length > 0 ? queued[queued.length - 1]! : null;
  const effective = pending?.state ?? room.housekeeping;
  const blocked = room.housekeeping === "out-of-service";

  return (
    <div
      data-hk-room={room.number}
      className={cn(
        "flex items-center gap-3 rounded-md border bg-white p-3",
        pending ? "border-brand-yellow" : "border-grey-200",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-ink-900 tabular">{room.number}</span>
          <span className="text-sm text-grey-500">{room.type}</span>
          {room.dueOut && <StatusPill tone="warning">Due out</StatusPill>}
        </div>
        <p className="text-sm text-grey-500 truncate mt-0.5">
          {room.occupied ? room.guest ?? "Occupied" : `Floor ${room.floor}`}
        </p>
        {pending && (
          <p className="text-2xs text-[#8a6300] mt-1" data-hk-pending>
            Queued: mark {pending.state}
          </p>
        )}
      </div>

      {/* 44px tap targets — a phone, one-handed, in a stairwell */}
      <div className="flex items-center gap-2 shrink-0">
        {blocked ? (
          <span className="flex items-center gap-1.5 text-sm text-brand-red px-2">
            <Wrench className="size-4" />
            Out of order
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onMark("clean")}
              disabled={effective !== "dirty"}
              aria-label={`Mark room ${room.number} clean`}
              className={cn(
                "flex items-center justify-center size-11 rounded-md border transition-colors duration-150",
                effective === "dirty"
                  ? "border-grey-300 bg-white hover:border-brand-orange hover:bg-brand-orange-50"
                  : "border-grey-200 bg-grey-50 text-grey-300 cursor-not-allowed",
              )}
            >
              <Sparkle className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => onMark("inspected")}
              disabled={effective !== "clean"}
              aria-label={`Mark room ${room.number} inspected`}
              className={cn(
                "flex items-center justify-center size-11 rounded-md border transition-colors duration-150",
                effective === "clean"
                  ? "border-grey-300 bg-white hover:border-success hover:bg-success-50"
                  : "border-grey-200 bg-grey-50 text-grey-300 cursor-not-allowed",
              )}
            >
              <Check className="size-5" />
            </button>
          </>
        )}
        {room.occupied && !blocked && (
          <BedDouble className="size-4 text-grey-300 ml-1" />
        )}
      </div>
    </div>
  );
}
