import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router";
import { Printer, Eye, LayoutGrid, DoorClosed, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useLiveOrders } from "@/lib/useLiveOrders";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, Field, fieldProps, Input,
} from "@/components/ui";
import { StartHere } from "@/components/app/StartHere";
import { mayReach } from "@/components/app/navigation";
import { useRole } from "@/lib/session";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import { draftedTables } from "@/lib/draft";
import { getFloor, markPrinted, clearTable, setOutletClosed, takeDishes, type FloorTable, type TableState, type OffFor } from "@/modules/pos/data/till";
import { ReadFailed, ReadStale } from "@/components/ui";
import { KotStatus } from "@/modules/pos/components/KotStation";

/* ══════════════════════════════════════════════════════════════════
   THE FLOOR

   The room, as a waiter sees it: sections first, because a person
   finds a table by walking to a section — a flat list of thirty tables
   is a list nobody scans.

   THE COLOUR IS DERIVED, NEVER STORED. Blank, running, KOT sent,
   printed, paid all come from the order and its lines. A stored status
   would be a sixth thing to keep in step, and it is the one that would
   be wrong on the night a manager is watching the floor.

   EVERY TILE ANSWERS THREE THINGS at a glance, which is all a person
   reads from across a room: is it busy, how long has it been sitting,
   and how much is on it. Anything else belongs on the bill.

   It refreshes on a timer because the elapsed minutes are the point —
   a tile frozen at "0 min" is worse than no tile.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

/* ⚠ THE SAME DURATIONS THE MENU USES, and for the same reason: a
   closure with no end is an outlet that stays shut for a week because
   whoever closed it went home. The time answers the question a waiter
   is about to be asked at a table. */
const CLOSE_FOR: { key: OffFor; label: string }[] = [
  { key: "2h", label: "2 hours" },
  { key: "4h", label: "4 hours" },
  { key: "8h", label: "8 hours" },
  { key: "24h", label: "24 hours" },
  { key: "next_business_day", label: "Rest of today" },
];

/* The fidato-design state tiles, as Rooms has them: a -50 wash and its
   -100 inset, the full colour on hover. The same meanings as before. */
const LEGEND: { state: TableState; label: string; swatch: string }[] = [
  { state: "blank",   label: "Free",    swatch: "bg-white ring-grey-300" },
  { state: "running", label: "Running", swatch: "bg-info-50 ring-info" },
  { state: "kot",     label: "In the kitchen", swatch: "bg-brand-orange-50 ring-brand-orange" },
  { state: "printed", label: "Bill printed",   swatch: "bg-success-50 ring-success" },
  { state: "paid",    label: "Paid - clear it", swatch: "bg-brand-yellow-50 ring-brand-yellow" },
];

const TILE: Record<TableState, string> = {
  blank:   "bg-white ring-grey-200 hover:ring-grey-400",
  running: "bg-info-50 ring-info-100 hover:ring-info",
  kot:     "bg-brand-orange-50 ring-brand-orange-100 hover:ring-brand-orange",
  printed: "bg-success-50 ring-success-100 hover:ring-success",
  paid:    "bg-brand-yellow-50 ring-brand-yellow-100 hover:ring-brand-yellow",
};

/* The tile's two small actions: 44px capsules, white on the tint. */
const TILE_ACTION = "press size-11 grid place-items-center rounded-full border border-grey-300 bg-white text-grey-600 hover:text-ink-900 hover:border-grey-400 cursor-pointer";

/** Restaurant setup (D22-6), where tables are laid out. */
const SETUP = "/pos/:code/setup";

export default function FloorPage() {
  const hotelId = useHotel();
  const role = useRole();
  /* The same live channel the pass uses. A kitchen moving a dish to
     ready, or another till taking a table, lands here rather than on
     the next poll -- both screens are the same service. */
  useLiveOrders(hotelId);

  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  /* Which table the pad is open on, and whether it is joining a bill
     that already exists. Null means the pad is closed — the floor is
     still the screen underneath either way. */
  const [pad, setPad] = useState<
    { table: FloorTable; orderId?: string } | null
  >(null);

  /* ⚠ A ROUND LEFT ON A PAD IS INVISIBLE OTHERWISE. The kitchen has
     nothing, the bill has nothing, and only the phone in one waiter's
     pocket knows it exists. The floor is where a manager would look, so
     the floor says so. */
  const [drafted, setDrafted] = useState<Set<string>>(new Set());
  const rescanDrafts = () => {
    void draftedTables(hotelId).then(setDrafted);
  };
  useEffect(rescanDrafts, [hotelId, pad]);

  const floor = useQuery({
    queryKey: ["floor", hotelId],
    queryFn: () => getFloor(hotelId),
    /* The elapsed minutes are the whole point of the tile. A screen that
       had to be reloaded by hand would show a table as five minutes old
       for the rest of the evening. */
    refetchInterval: 30_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["floor", hotelId] });

  /* ⚠ NO NETWORK CALL AND NO NAVIGATION.
     This used to open an order on the server and then leave for the
     till — so a waiter standing at the table walked back to a terminal
     to do the thing they were already standing in front of, and paid a
     round trip to Mumbai before the first dish was even chosen.

     The pad opens over this screen from the cached menu. The order is
     created by the batch request when Send is pressed, once, with every
     dish on it. */
  const open = (table: FloorTable) => {
    setPad({ table });
  };

  /* Another round on a bill that is already open. Same pad, carrying
     the order id, so the dishes join that bill rather than starting a
     second one on the same table. */
  const addRound = (table: FloorTable) => {
    if (!table.orderId) return;
    setPad({ table, orderId: table.orderId });
  };

  const print = async (table: FloorTable) => {
    if (!table.orderId) return;
    setBusy(table.id);
    const res = await markPrinted(hotelId, table.orderId);
    setBusy(null);
    if (!res.ok) return toast.error("Not printed", res.reason);
    window.open(`/pos/${hotelId}/bill/${table.orderId}`, "_blank");
    refresh();
  };

  const clear = async (table: FloorTable) => {
    if (!table.orderId) return;
    setBusy(table.id);
    const res = await clearTable(hotelId, table.orderId);
    setBusy(null);
    /* The server's wording. It knows whether the bill was settled, and
       says to take payment first — which is what the waiter does next. */
    if (!res.ok) return toast.error("Not cleared", res.reason);
    toast.success(`${table.label} is free`);
    refresh();
  };

  /* Every ready dish on the table, taken out at once (D27-222). */
  const take = async (table: FloorTable) => {
    if (!table.orderId || !table.readyIds?.length) return;
    setBusy(table.id);
    const res = await takeDishes(hotelId, table.orderId, table.readyIds);
    setBusy(null);
    if (!res.ok) return toast.error("Not taken", res.reason);
    refresh();
  };

  const sections = floor.data?.sections ?? [];
  const outlet = floor.data?.outlet ?? null;
  const closed = outlet?.closedUntil
    && Date.parse(outlet.closedUntil) > Date.now();
  /* WHEN, not just whether. A manager who closed it at four wants to
     see the hour it comes back, and so does the waiter standing next
     to them. */
  const reopens = closed && outlet?.closedUntil
    ? new Date(outlet.closedUntil).toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Page>
      <PageHeader
        /* "Tables", as the menu says (15 September). "Floor" also names the
           Rooms screen's building-floor grouping — one word, two things. */
        title="Tables"
        description="The room as it stands. Tap any table to take an order on it - the pad opens here, and nothing reaches the kitchen until you send it."
        actions={outlet && (
          <CloseOutlet outlet={outlet} closed={!!closed} hotelId={hotelId}
                       onDone={refresh} />
        )}
      />

      <StartHere className="mb-5" />

      <KotStatus hotelId={hotelId} className="mb-5" />

      {closed && (
        <Card className="mb-5">
          <CardBody>
            <p className="text-sm text-ink-900 font-medium">
              {outlet?.name} is closed{reopens ? ` until ${reopens}` : ""}
              {/* Why, when somebody said. The refusal a waiter gets has
                  always carried the reason; the banner a manager reads
                  did not, and the two disagreed about how much they
                  knew. */}
              {outlet?.closedReason ? ` - ${outlet.closedReason}` : ""}.
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              Bills already open can still be settled and printed. New orders
              are refused until it reopens.
            </p>
          </CardBody>
        </Card>
      )}

      {/* The key: a 12px caption, as the Rooms strip's. */}
      <div className="flex gap-x-4 gap-y-2 flex-wrap mb-5">
        {LEGEND.map((l) => (
          <span key={l.state} className="flex items-center gap-2 text-xs font-medium text-grey-600 whitespace-nowrap">
            <i className={cn("size-3 rounded-[4px] ring-1 ring-inset", l.swatch)} />
            {l.label}
          </span>
        ))}
      </div>

      {/* POS-4: a failed refresh keeps the tables and says they are not
          current; a failed first load says so instead of "No tables
          have been laid out yet". */}
      {floor.error && floor.data !== undefined && (
        <ReadStale
          className="mb-5"
          error={floor.error}
          loadedAt={floor.dataUpdatedAt}
          onRetry={() => void floor.refetch()}
        />
      )}

      {floor.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : floor.data === undefined && floor.error ? (
        <Card>
          <ReadFailed
            error={floor.error}
            what="the tables"
            onRetry={() => void floor.refetch()}
          />
        </Card>
      ) : sections.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<LayoutGrid />}
            title="No tables have been laid out yet."
            description="A section is a part of the room - A/C, Non A/C, the bar - and tables sit inside one. Until they exist, an order carries whatever the waiter types."
            /* D22-6: for the owner, an administrator and the GM, who may set
               them up; a waiter reads the sentence above only. */
            action={mayReach(role, SETUP) && (
              <Button onClick={() => navigate(SETUP.replace(":code", hotelId))}>
                Set up tables
              </Button>
            )}
          />
        </Card>
      ) : (
        /* Sections are groups: 24px apart, a 16px heading 12px over its
           tiles, the tiles 8px apart (the Rhythm Rule). */
        sections.map((section) => (
          <section key={section.id} className="mb-6 last:mb-0">
            <h2 className="text-md font-semibold text-ink-900 mb-3">
              {section.name}
            </h2>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
              {section.tables.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "relative rounded-lg ring-1 ring-inset px-3.5 py-3 min-h-24 flex flex-col",
                    "transition-[box-shadow,background-color] duration-150",
                    TILE[t.state],
                    /* An unsent round outranks the tile's own colour.
                       A free-looking table with six dishes on somebody's
                       pad is the one thing this screen would otherwise
                       be wrong about. */
                    drafted.has(t.id) && "ring-0 hover:ring-0 border border-dashed border-brand-orange",
                  )}
                >
                  {drafted.has(t.id) && (
                    <span
                      className="absolute top-3 right-3.5 text-2xs font-medium text-brand-orange-700"
                      title="A round is on a pad and has not been sent"
                    >
                      not sent
                    </span>
                  )}
                  {t.state === "blank" ? (
                    <button
                      type="button"
                      disabled={busy === t.id || Boolean(closed)}
                      onClick={() => open(t)}
                      className={cn(
                        "flex-1 flex flex-col items-start justify-center text-left",
                        closed ? "cursor-not-allowed" : "cursor-pointer press-tile",
                      )}
                    >
                      {/* Free, as on Rooms: the name in grey-700 at 500. */}
                      <span className="text-xl font-medium text-grey-700 tabular tracking-[-0.02em]">
                        {t.label}
                      </span>
                      {/* The last line ends in the arrow while the tile opens
                          the pad (the Tappable Rule, as on Rooms). */}
                      <span className="w-full flex items-center gap-2">
                        {t.seats && (
                          <span className="text-sm text-grey-500 tabular">
                            {t.seats} seats
                          </span>
                        )}
                        {!closed && <ChevronRight className="ml-auto size-4 shrink-0 text-grey-400" aria-hidden />}
                      </span>
                    </button>
                  ) : (
                    <>
                      {/* TAPPING A RUNNING TABLE ADDS A ROUND, exactly as
                          tapping a free one opens the first. One gesture
                          means one thing across the whole floor, and the
                          pad opens over this screen either way.

                          A settled bill is the exception: it takes no more
                          dishes, and Clear is what that table needs. */}
                      <button
                        type="button"
                        disabled={t.state === "paid" || Boolean(closed)}
                        onClick={() => addRound(t)}
                        aria-label={`Add a round to ${t.label}`}
                        className={cn(
                          "flex-1 flex flex-col items-start text-left w-full",
                          t.state === "paid" || closed
                            ? "cursor-not-allowed"
                            : "cursor-pointer press-tile",
                        )}
                      >
                        {/* Three things, in the order a person reads them
                            across a room: how long, which table, how much.
                            grey-600 at the least: they sit on a tint. */}
                        <span className="tabular text-xs font-medium text-grey-600">
                          {t.minutes} min
                        </span>
                        <span className="text-xl font-semibold text-ink-900 tabular tracking-[-0.02em]">
                          {t.label}
                        </span>
                        <span className="mt-auto w-full flex items-center justify-between gap-2">
                          <span className="tabular text-md font-semibold text-ink-900">
                            {t.payable === null ? "-" : money(t.payable)}
                          </span>
                          {/* It opens the pad for another round: the arrow.
                              A paid table takes no more, so none. */}
                          {t.state !== "paid" && !closed && (
                            <ChevronRight className="size-4 shrink-0 text-grey-400" aria-hidden />
                          )}
                        </span>
                      </button>

                      {/* FOOD AT THE PASS (D27-221). The kitchen made it
                          Ready; one tap says the waiter took it all out
                          (D27-222). The tile's own tap still opens the pad.
                          A row of its own: beside the two round buttons it
                          wrapped on a desktop tile (126px, measured). */}
                      {(t.ready ?? 0) > 0 && t.orderId && (
                        <button
                          type="button"
                          disabled={busy === t.id}
                          onClick={() => void take(t)}
                          aria-label={`Taken: the ${t.ready} ready at ${t.label}`}
                          className="press mt-2 w-full h-11 px-3 rounded-full ring-1 ring-inset ring-success-100 bg-success-50 text-success-600 text-sm font-semibold tabular whitespace-nowrap cursor-pointer hover:ring-success"
                        >
                          {t.ready} ready
                        </button>
                      )}
                      <div className="flex gap-2 mt-2">
                        {t.state === "paid" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            loading={busy === t.id}
                            onClick={() => void clear(t)}
                          >
                            Clear
                          </Button>
                        ) : (
                          <>
                            <button
                              type="button"
                              aria-label={`Print the bill for ${t.label}`}
                              disabled={busy === t.id}
                              onClick={() => void print(t)}
                              className={TILE_ACTION}
                            >
                              <Printer className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Open ${t.label}`}
                              onClick={() => navigate(
                                `/pos/${hotelId}/till?order=${t.orderId}`)}
                              className={TILE_ACTION}
                            >
                              <Eye className="size-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {/* Over the floor, never instead of it. The pad closes and the
          waiter is looking at the same room they were looking at. */}
      {pad && (
        <OrderPad
          hotelId={hotelId}
          outlet="REST"
          tableId={pad.table.id}
          tableLabel={pad.table.label}
          {...(pad.orderId ? { orderId: pad.orderId } : {})}
          open
          onOpenChange={(o) => { if (!o) setPad(null); }}
          onSent={() => { setPad(null); refresh(); }}
        />
      )}
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CLOSING THE OUTLET EARLY

   ⚠ EVERYTHING FOR THIS EXISTED EXCEPT THE WAY IN. The endpoint has
   been in `till.ts` since the POS was built; `setOutletClosed` has
   been on the seam beside it; the banner above renders the state it
   produces, and the order endpoint refuses with the reason it stores.
   Nothing anywhere could set it. A manager whose kitchen lost power
   had to ask for a database session, or watch waiters take orders
   nothing could cook.

   That is this project's most common defect and it is the reason the
   reachability gate in `repositories.test.ts` exists — `setOutletClosed`
   was the first name on its backlog. This screen takes it off.

   IT DOES NOT STOP THE MONEY. A closed outlet refuses NEW orders and
   nothing else: bills already open are settled and printed as usual.
   Closing a restaurant with eleven tables mid-meal and no way to bill
   them would be a worse fault than the one being fixed.
   ══════════════════════════════════════════════════════════════════ */
function CloseOutlet({
  outlet, closed, hotelId, onDone,
}: {
  outlet: { code: string; name: string };
  closed: boolean; hotelId: string; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = async (until: OffFor) => {
    setBusy(true);
    const res = await setOutletClosed(
      hotelId, outlet.code, true, until, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not closed", res.reason);
    setOpen(false);
    setReason("");
    toast.success(`${outlet.name} is closed`, `Back in ${
      CLOSE_FOR.find((o) => o.key === until)?.label.toLowerCase()}.`);
    onDone();
  };

  const reopen = async () => {
    setBusy(true);
    const res = await setOutletClosed(hotelId, outlet.code, false);
    setBusy(false);
    if (!res.ok) return toast.error("Not reopened", res.reason);
    toast.success(`${outlet.name} is open`);
    onDone();
  };

  if (closed) {
    return (
      <Button variant="secondary" className="h-11" loading={busy}
              onClick={() => void reopen()}>
        Reopen {outlet.name}
      </Button>
    );
  }

  return (
    <>
      <Button variant="secondary" className="h-11"
              onClick={() => setOpen(true)}>
        <DoorClosed className="size-4" /> Close early
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Close ${outlet.name}`}
          description="New orders are refused. Bills already open are settled and printed as usual."
          size="sm"
          footer={
            <Button variant="secondary" size="lg"
                    onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="Why"
                   hint="Shown to the waiter who tries to ring an order.">
              {(f) => (
                <Input {...fieldProps(f)} value={reason} autoFocus
                       placeholder="Power cut"
                       onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
            {/* ⚠ FOR HOW LONG, and there is no "until I say". A closure
                with no end is one nobody remembers to undo, and the
                first person to find out is a guest being turned away
                from an open restaurant. */}
            <div className="grid grid-cols-2 gap-2">
              {CLOSE_FOR.map((o) => (
                <Button key={o.key} variant="secondary" size="lg"
                        loading={busy} onClick={() => void close(o.key)}>
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
