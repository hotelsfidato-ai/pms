import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Check, CloudOff, RefreshCw, Sparkle, Wrench, BedDouble, UserRound, SprayCan, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { HeldError } from "@/lib/api";
import {
  isOnline, watchConnection, list as outboxList, subscribe as outboxSubscribe,
} from "@/lib/offline";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, StatusPill, toast, Button, Card, EmptyState, ErrorState, Skeleton,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { listHousekeeping, markRoom, type HousekeepingRoom, listHousekeepers, listRoomAssignments, assignHousekeeper, unassignHousekeeper, type Housekeeper, type RoomAssignment } from "@/modules/housekeeping/data/housekeeping";
import { BUSINESS_DATE, listAllRooms, type RoomBlock } from "@/data/repositories";
import { OutOfOrderFlow } from "@/modules/housekeeping/flows/OutOfOrderFlow";
import { RepairFlow } from "@/modules/housekeeping/flows/RepairFlow";

/* ══════════════════════════════════════════════════════════════════
   FLOW E — housekeeping, on a phone

   Designed for a phone held one-handed in a stairwell. Tap targets,
   not mouse targets: every control is at least 44px.

   A change made with no signal is HELD VISIBLY. A housekeeper needs
   to know their work was recorded even when the signal has gone — an
   action that silently does nothing is worse than one that refuses.
   ══════════════════════════════════════════════════════════════════ */

/* The same words as the Rooms board (the clarity plan's one vocabulary).
   These were a THIRD set — "Vacant dirty", "Occupied", "Out of order" —
   beside the board's own two, so a housekeeper and the desk talking about
   one room used different names for it. The keys are unchanged. */
const GROUPS = [
  { key: "dirty", label: "Needs cleaning", tone: "warning" as const },
  { key: "clean", label: "Clean", tone: "info" as const },
  { key: "inspected", label: "Inspected", tone: "success" as const },
  { key: "occupied", label: "In house", tone: "neutral" as const },
  { key: "out-of-service", label: "Out of service", tone: "danger" as const },
];

/* A room nobody has been given. Its own filter, because it is the one
   a supervisor needs before the shift starts — the rooms that would
   otherwise go uncleaned because everybody assumed somebody else had
   them. */
/* A plain string, not a NUL sentinel. The clever version put a real
   0x00 byte in the source, which made grep call this file binary and
   would have done the same to diffs and half the tooling. It cannot
   collide with a staff id regardless: those are uuids. */
const UNASSIGNED = "unassigned";

/* WAS a local queue type. The queue now lives in IndexedDB, shared
   with every other screen, so this is only how a room's held change is
   READ back for display. */
interface QueuedChange {
  id: string;
  roomNumber: string;
  state: string;
}

export default function HousekeepingPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const qc = useQueryClient();

  /* The browser already knows, and this used to ask a button instead.
     `useState(true)` that only "Simulate offline" ever changed meant
     that on a phone which genuinely lost signal in a stairwell the
     flag stayed TRUE, the write threw past the handler, and the
     housekeeper's tap did nothing at all — no toast, no queue, no
     refusal. The demo prop was hiding the only case that matters.

     NOW READ FROM ONE PLACE. This screen kept its own answer from
     `navigator.onLine` while the shell kept another from whether
     requests were actually arriving, and the two disagreed on screen:
     the banner here said "Online" above a bar saying "No connection",
     in the one situation that matters — the wifi up and the line down.

     `isOnline()` is the shared answer, and it believes a failed
     request over the browser's optimism. */
  const [online, setOnline] = useState(() => isOnline());

  useEffect(() => watchConnection(() => setOnline(isOnline())), []);
  /* THE QUEUE IS NOT THIS SCREEN'S ANY MORE.

     It used to be `useState`, which meant a refresh lost it — the phone
     locking, the tab closing, the browser reclaiming memory. A
     housekeeper who tapped four rooms on a stairwell and then unlocked
     their phone had tapped nothing, with no message saying so. That is
     the same fault the queue was built to prevent, moved one layer out,
     and it was found by pressing reload with the API stopped.

     Every write now goes through `api()`, which holds it in IndexedDB
     when the request cannot leave the phone, and the shell drains it.
     One queue, one drain, one place that decides what may be held. */
  const [held, setHeld] = useState<QueuedChange[]>([]);

  const readHeld = useCallback(() => {
    void outboxList().then((entries) => {
      setHeld(
        entries
          .filter((e) => e.status === "waiting")
          .map((e) => {
            /* The room number is in the path, which is also what the
               tier rule matches on, so the two cannot drift apart. */
            const room = /\/rooms\/([^/]+)\/housekeeping/.exec(e.path)?.[1];
            if (!room) return null;
            const state = (() => {
              try {
                return (JSON.parse(e.body ?? "{}") as { state?: string }).state ?? "";
              } catch {
                return "";
              }
            })();
            return { id: e.id, roomNumber: decodeURIComponent(room), state };
          })
          .filter((x): x is QueuedChange => x !== null),
      );
    }).catch(() => {
      /* No store on this device — a private window, a browser without
         IndexedDB, the test browser. Nothing can have been held here, so
         nothing is waiting. The offline bar, on every screen, is what TELLS
         the person their work cannot be held; this only stops the board
         leaving an uncaught error behind (it ended every test run red,
         MEMORY 274). The same catch OfflineBar has had since it met this. */
      setHeld([]);
    });
  }, []);

  useEffect(() => {
    readHeld();
    return outboxSubscribe(readHeld);
  }, [readHeld]);

  const rooms = useQuery({
    queryKey: ["housekeeping", hotelId, BUSINESS_DATE],
    queryFn: () => listHousekeeping(hotelId, BUSINESS_DATE),
  });

  /* Who is on today, and which rooms are theirs. Two queries rather
     than one join: the roster changes when somebody is hired and the
     sheet changes several times a morning, so they cache apart. */
  const staff = useQuery({
    queryKey: ["housekeepers", hotelId],
    queryFn: () => listHousekeepers(hotelId),
  });
  const sheet = useQuery({
    queryKey: ["hk-assignments", hotelId],
    queryFn: () => listRoomAssignments(hotelId),
  });

  /* The board's own room list carries a housekeeping state and no
     blocks. A block is a PERIOD and the state is only now, so taking a
     room out — and seeing when it comes back — needs the other one. */
  const detail = useQuery({
    queryKey: ["rooms", hotelId],
    queryFn: () => listAllRooms(hotelId),
  });
  const blocksFor = new Map<string, RoomBlock[]>(
    (detail.data ?? []).map((r) => [r.number, r.blocks]),
  );

  /* null is everyone. A supervisor sets the rota looking at every
     room; a housekeeper narrows it to their own and the board finally
     answers the question they actually came to it with. */
  const [only, setOnly] = useState<string | null>(null);

  const assignedTo = new Map<string, RoomAssignment>(
    (sheet.data?.assignments ?? []).map((a) => [a.room, a]),
  );

  const assign = async (roomNumber: string, staffId: string) => {
    const res = staffId
      ? await assignHousekeeper(hotelId, roomNumber, staffId)
      : await unassignHousekeeper(hotelId, roomNumber);
    if (!res.ok) return toast.error("Not assigned", res.reason);
    await qc.invalidateQueries({ queryKey: ["hk-assignments"] });
  };

  const apply = async (room: HousekeepingRoom, state: "clean" | "inspected") => {
    /* ALWAYS ATTEMPTED. The old version checked `online` first and held
       the tap without trying, which meant a wifi that was up with no
       route out — the commonest hotel failure — took the slow path
       every time and the queue never learned otherwise.

       The attempt is the test. `api()` decides: it arrives, or it is
       held, or it is refused with a reason. */
    try {
      const res = await markRoom(hotelId, room.number, state);
      if (res.ok) qc.invalidateQueries();
      else toast.error("Could not update", res.reason);
    } catch (error) {
      /* HeldError only — a refusal comes back through `res.ok` above,
         because the repository converts an ApiError into a reason. */
      if (error instanceof HeldError) {
        toast.warning("Saved on this phone", error.message);
        return;
      }
      throw error;
    }
  };

  const everything = rooms.data ?? [];
  const all = only === null
    ? everything
    : everything.filter((r) =>
        only === UNASSIGNED
          ? !assignedTo.has(r.number)
          : assignedTo.get(r.number)?.staffId === only);

  const sheetOwner = (staff.data ?? []).find((p) => p.id === only)?.name;

  const bucket = (key: string) =>
    key === "occupied"
      ? all.filter((r) => r.occupied && r.housekeeping !== "out-of-service")
      : all.filter((r) => !r.occupied && r.housekeeping === key);

  const queuedFor = (number: string) => held.filter((q) => q.roomNumber === number);

  /* WAS max-w-2xl. That was right when every room was a full-width row
     and the page was read top to bottom on a phone — 672px keeps a line
     readable. It is wrong for a grid of cards: on a desk it threw away
     500px of a 1177px column and drew two columns where four fit, which
     is most of why this looked like a ladder.

     max-w-6xl still stops the cards stretching absurdly on a very wide
     monitor. */
  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Housekeeping"
        description="Tap a room to move it on. Clean, then inspected."
      />

      <StartHere className="mb-5" />

      {/* Connectivity, read from the browser rather than asserted. */}
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
          {held.length > 0 && (
            <p className="text-sm text-[#8a6300] tabular" data-queue-count>
              {held.length} change{held.length === 1 ? "" : "s"} waiting to sync
            </p>
          )}
        </div>
      </div>

      {/* Whose sheet. Scrolls sideways on a phone rather than wrapping
          into a block that pushes the rooms off the screen. */}
      {(staff.data?.length ?? 0) > 0 && (
        <div className="-mx-1 mb-5 overflow-x-auto">
          <div className="flex items-center gap-2 px-1 pb-1 w-max">
            <SheetChip
              label="All rooms"
              count={everything.length}
              active={only === null}
              onClick={() => setOnly(null)}
            />
            {(staff.data ?? []).map((person: Housekeeper) => {
              const count = everything.filter(
                (r) => assignedTo.get(r.number)?.staffId === person.id,
              ).length;
              return (
                <SheetChip
                  key={person.id}
                  label={person.name}
                  count={count}
                  active={only === person.id}
                  onClick={() => setOnly(person.id)}
                />
              );
            })}
            <SheetChip
              label="Unassigned"
              count={everything.filter((r) => !assignedTo.has(r.number)).length}
              active={only === UNASSIGNED}
              onClick={() => setOnly(UNASSIGNED)}
            />
          </div>
        </div>
      )}

      {/* The board had no loading, error or empty state: while the rooms
          loaded, or when they failed, a housekeeper saw a heading and an
          "Online" line and nothing else — the same screen as a hotel with
          nothing to clean. Each case now says which it is. */}
      {rooms.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : rooms.error ? (
        <Card>
          <ErrorState
            title="The rooms did not load"
            error={rooms.error}
            onRetry={() => void rooms.refetch()}
          />
        </Card>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<SprayCan />}
            title={
              only === null ? "No rooms set up yet"
                : only === UNASSIGNED ? "Every room is on somebody's sheet"
                : sheetOwner ? `No rooms on ${sheetOwner}'s sheet yet` : "No rooms on this sheet yet"
            }
            description={
              only === null
                ? "Once the property's rooms are added, each one shows here with what it needs."
                : only === UNASSIGNED
                  ? "Nothing is left unassigned."
                  : "Give them rooms from each room's card, or look at every room."
            }
            action={only !== null ? (
              <Button variant="secondary" onClick={() => setOnly(null)}>Show all rooms</Button>
            ) : undefined}
          />
        </Card>
      ) : (
      <div className="space-y-6">
        {GROUPS.map((group) => {
          const list = bucket(group.key);
          if (list.length === 0) return null;
          return (
            <section key={group.key} data-hk-group={group.key} className="@container">
              <div className="flex items-center gap-2 mb-2.5">
                <h2 className="text-md font-semibold text-ink-900">{group.label}</h2>
                <StatusPill tone={group.tone}>{list.length}</StatusPill>
              </div>

              {/* CARDS IN A GRID, not a ladder of full-width rows. On a
                  desk that list put the room number at the far left and
                  its two buttons at the far right with a metre of
                  nothing between them, and eighteen rooms ran well past
                  the fold. A card is scanned; a row that wide is read.

                  Container, not viewport: this page sits beside a 264px
                  sidebar, so the window's width is not this column's —
                  the same trap the till menu had. */}
              <ul className="grid gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
                {list.map((room) => (
                  <li key={room.number}>
                    <RoomCard
                      room={room}
                      queued={queuedFor(room.number)}
                      onMark={(state) => apply(room, state)}
                      staff={staff.data ?? []}
                      assignment={assignedTo.get(room.number) ?? null}
                      onAssign={(id) => void assign(room.number, id)}
                      hotelId={hotelId}
                      blocks={blocksFor.get(room.number) ?? []}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      )}
    </Page>
  );
}

function RoomCard({
  room, queued, onMark, staff, assignment, onAssign, hotelId, blocks,
}: {
  room: HousekeepingRoom;
  queued: QueuedChange[];
  onMark: (state: "clean" | "inspected") => void;
  staff: Housekeeper[];
  assignment: RoomAssignment | null;
  onAssign: (staffId: string) => void;
  hotelId: string;
  blocks: RoomBlock[];
}) {
  const pending = queued.length > 0 ? queued[queued.length - 1]! : null;
  const effective = pending?.state ?? room.housekeeping;
  const blocked = room.housekeeping === "out-of-service";

  /* WHY A GREY BUTTON IS GREY, said when it is tapped (the owner, D17-8,
     17 September). The icons were greyed in silence: a screen reader was
     told "Mark room 202 clean, dimmed" and the housekeeper looking at the
     screen was told nothing. The sentence belongs to this card and goes
     when the room moves on, because it is only true of the state it was
     said about. */
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => setSaid(null), [effective]);
  const [repairing, setRepairing] = useState(false);
  const [takingOut, setTakingOut] = useState(false);

  return (
    <div
      data-hk-room={room.number}
      className={cn(
        /* `h-full` so every card in a row is the same height whatever
           its assignee name does. Without it a long name makes one card
           taller and the row reads as broken. */
        /* `relative` so this card's own hidden label belongs to it
           rather than to the page. The shell now anchors these anyway;
           this keeps the card correct on its own terms. */
        "relative h-full flex flex-col gap-2 rounded-lg border bg-white p-3",
        "transition-colors duration-150",
        pending ? "border-brand-yellow bg-brand-yellow-50/40" : "border-grey-200",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl font-semibold text-ink-900 tabular leading-none">
            {room.number}
          </span>
          <span className="text-sm text-grey-500">{room.type}</span>
          {room.dueOut && <StatusPill tone="warning">Due out</StatusPill>}
          {room.occupied && !blocked && (
            <BedDouble className="size-3.5 text-grey-400 shrink-0" />
          )}
        </div>
        <p className="text-sm text-grey-500 truncate mt-1">
          {room.occupied ? room.guest ?? "In house" : `Floor ${room.floor}`}
        </p>
        {pending && (
          <p className="text-2xs text-[#8a6300] mt-1" data-hk-pending>
            Queued: mark {pending.state}
          </p>
        )}

        {/* A native select on purpose. On a phone it opens the OS
            picker — full-screen, thumb-sized rows, scrollable with one
            hand — which is better than anything a custom dropdown
            gives on the same screen, and it is the same control on the
            desk. */}
        {staff.length > 0 && (
          <label className="flex items-center gap-1.5 mt-1.5">
            <span className="sr-only">
              Who is cleaning room {room.number}
            </span>
            <UserRound
              className={cn(
                "size-3.5 shrink-0",
                assignment ? "text-grey-500" : "text-grey-300",
              )}
            />
            <select
              value={assignment?.staffId ?? ""}
              onChange={(e) => onAssign(e.target.value)}
              data-hk-assignee={room.number}
              className={cn(
                /* 44px, like the buttons below it: measured at 36px on
                    16 September, on the one screen built for a phone. */
                "min-h-11 -ml-1 pl-1 pr-1 rounded bg-transparent",
                "text-sm border-0 cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-brand-orange",
                assignment ? "text-ink-900" : "text-grey-500",
              )}
            >
              <option value="">Unassigned</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* 44px tap targets — a phone, one-handed, in a stairwell.
          `mt-auto` pins this to the bottom of the card so the buttons
          line up across a row whatever the text above them does.
          THREE EQUAL COLUMNS once each carries a word: measured at 375px
          the card's inside is 311px, so a column is about 98px — room
          for "Inspected" on one line with the icon above it. */}
      <div className="mt-auto pt-1">
      <div className={cn(blocked ? "flex items-center gap-2" : "grid grid-cols-3 gap-2")}>
        {blocked ? (
          /* This was a text label. A room could get INTO this state and
             the board offered nothing to get it out again — the only
             blocks in the system came from the demo loader, so nobody
             had needed one. It is a button now. */
          <OutOfOrderFlow
            hotelId={hotelId}
            roomNumber={room.number}
            blocks={blocks}
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                data-hk-put-back={room.number}
                className={cn(
                  "flex items-center gap-1.5 min-h-11 px-2.5 rounded-md",
                  "text-sm text-brand-red border border-transparent",
                  "hover:border-brand-red-100 hover:bg-red-50 cursor-pointer",
                  "transition-colors duration-150",
                )}
              >
                <RotateCcw className="size-4" />
                {/* WHAT IT DOES (the owner, 17 September). It said "Take out
                    of service" on a room that was already out, and opened
                    what is out with "Put back" on it. */}
                Put back
              </button>
            )}
          />
        ) : (
          <>
            <MarkButton
              label="Clean"
              icon={Sparkle}
              ariaLabel={`Mark room ${room.number} clean`}
              ready={effective === "dirty"}
              reason={whyNotClean(room.number, effective, !!pending)}
              onPress={() => onMark("clean")}
              onRefused={setSaid}
              hover="hover:border-brand-orange hover:bg-brand-orange-50"
            />
            <MarkButton
              label="Inspected"
              icon={Check}
              ariaLabel={`Mark room ${room.number} inspected`}
              ready={effective === "clean"}
              reason={whyNotInspected(room.number, effective, !!pending)}
              onPress={() => onMark("inspected")}
              onRefused={setSaid}
              hover="hover:border-success hover:bg-success-50"
            />
          </>
        )}
        {/* REPAIR (the owner, D17-8 and 17 September): it reports a repair
            for this room. Taking the room out of service is a second choice
            inside it — a dripping tap does not cost a night's sale — and
            "out of service without a repair" (NC, refurbishment) is at its
            foot. It is never grey: anybody on the board may report one. */}
        {!blocked && (
          <>
            <MarkButton
              label="Repair"
              icon={Wrench}
              ariaLabel={`Report a repair in room ${room.number}`}
              ready
              reason=""
              onPress={() => setRepairing(true)}
              onRefused={setSaid}
              hover="hover:border-grey-400 hover:bg-grey-50"
            />
            <RepairFlow
              hotelId={hotelId}
              open={repairing}
              onOpenChange={setRepairing}
              title={`Report a repair · Room ${room.number}`}
              room={{ number: room.number, occupied: room.occupied }}
              onOutOfServiceOnly={() => setTakingOut(true)}
            />
            <OutOfOrderFlow
              hotelId={hotelId}
              roomNumber={room.number}
              blocks={blocks}
              occupied={room.occupied}
              open={takingOut}
              onOpenChange={setTakingOut}
            />
          </>
        )}
      </div>
      {/* Always in the page, empty until something is said, so a screen
          reader is listening before the sentence arrives. The words are
          the style the desk's menu uses for a reason (`MenuItem`). */}
      <p
        role="status"
        data-hk-reason={room.number}
        className={cn("text-sm text-grey-500 leading-snug", said ? "mt-2" : "sr-only")}
      >
        {said ?? ""}
      </p>
      </div>
    </div>
  );
}

/* ── Why a button is grey ─────────────────────────────────────────────
   The same order the server refuses in (`roomStatus.ts`): a room is
   cleaned, then inspected. "On this phone" when the state is a tap still
   waiting to sync, because the server has not heard it yet and the
   housekeeper should not think it has. */
function whyNotClean(number: string, state: string, held: boolean): string {
  const here = held ? " on this phone, waiting to sync" : "";
  if (state === "clean") return `Room ${number} is already marked clean${here}.`;
  if (state === "inspected") return `Room ${number} is already inspected${here}.`;
  return `Room ${number} cannot be marked clean from here.`;
}

function whyNotInspected(number: string, state: string, held: boolean): string {
  const here = held ? " on this phone, waiting to sync" : "";
  if (state === "dirty") return `Room ${number} needs cleaning first.`;
  if (state === "inspected") return `Room ${number} is already inspected${here}.`;
  return `Room ${number} cannot be marked inspected from here.`;
}

/**
 * One of the room card's buttons: its icon, and its word under it.
 *
 * NOT `disabled`. A disabled button swallows the tap, and the tap is the
 * only moment a housekeeper asks why. `aria-disabled` keeps it announced as
 * unavailable and lets the tap through to say so.
 */
function MarkButton({
  label, icon: Icon, ariaLabel, ready, reason, onPress, onRefused, hover,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ariaLabel: string;
  ready: boolean;
  reason: string;
  onPress: () => void;
  onRefused: (reason: string) => void;
  hover: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={ready ? undefined : true}
      data-hk-mark={label}
      onClick={() => (ready ? onPress() : onRefused(reason))}
      className={cn(
        "flex flex-col items-center justify-center gap-1 min-h-14 w-full px-1",
        "rounded-md border text-sm leading-none transition-colors duration-150",
        ready
          ? cn("border-grey-300 bg-white text-ink-900 cursor-pointer", hover)
          : "border-grey-200 bg-grey-50 text-grey-500 cursor-not-allowed",
      )}
    >
      <Icon className={cn("size-5 shrink-0", !ready && "text-grey-300")} />
      <span>{label}</span>
    </button>
  );
}

/** One name on the rota, with how many rooms are on their sheet. */
function SheetChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 shrink-0",
        "h-11 px-3.5 rounded-full border text-base",
        "transition-colors duration-150 cursor-pointer",
        active
          ? "border-brand-orange bg-brand-orange-50 text-ink-900"
          : "border-grey-200 bg-white text-grey-700 hover:border-grey-300",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular text-sm",
          active ? "text-brand-orange-700" : "text-grey-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}
