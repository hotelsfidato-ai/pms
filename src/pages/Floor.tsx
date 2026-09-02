import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router";
import { Printer, Eye, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, toast,
} from "@/components/ui";
import {
  getFloor, openOrderOnTable, markPrinted, clearTable,
  type FloorTable, type TableState,
} from "@/data/repositories";

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

const LEGEND: { state: TableState; label: string; swatch: string }[] = [
  { state: "blank",   label: "Free",    swatch: "bg-white border-grey-300" },
  { state: "running", label: "Running", swatch: "bg-info-50 border-info" },
  { state: "kot",     label: "In the kitchen", swatch: "bg-orange-50 border-brand-orange" },
  { state: "printed", label: "Bill printed",   swatch: "bg-green-50 border-success" },
  { state: "paid",    label: "Paid — clear it", swatch: "bg-yellow-50 border-brand-yellow" },
];

const TILE: Record<TableState, string> = {
  blank:   "bg-white border-grey-300 hover:border-grey-400",
  running: "bg-info-50 border-info",
  kot:     "bg-orange-50 border-brand-orange",
  printed: "bg-green-50 border-success",
  paid:    "bg-yellow-50 border-brand-yellow",
};

export default function FloorPage() {
  const hotelId = useHotel();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const floor = useQuery({
    queryKey: ["floor", hotelId],
    queryFn: () => getFloor(hotelId),
    /* The elapsed minutes are the whole point of the tile. A screen that
       had to be reloaded by hand would show a table as five minutes old
       for the rest of the evening. */
    refetchInterval: 30_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["floor", hotelId] });

  const open = async (table: FloorTable) => {
    setBusy(table.id);
    const res = await openOrderOnTable(hotelId, "REST", table.id);
    setBusy(null);
    if (!res.ok) return toast.error("Not opened", res.reason);
    /* Straight to THAT bill, named in the URL. Landing on the list is
       how a waiter opens a second order on the same table, because the
       first one looked like it had not worked. */
    navigate(`/h/${hotelId}/till?order=${res.order.id}`);
  };

  const print = async (table: FloorTable) => {
    if (!table.orderId) return;
    setBusy(table.id);
    const res = await markPrinted(hotelId, table.orderId);
    setBusy(null);
    if (!res.ok) return toast.error("Not printed", res.reason);
    window.open(`/h/${hotelId}/till/bill/${table.orderId}`, "_blank");
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

  const sections = floor.data?.sections ?? [];
  const closed = floor.data?.outlet?.closedUntil
    && Date.parse(floor.data.outlet.closedUntil) > Date.now();

  return (
    <Page>
      <PageHeader
        title="Floor"
        description="The room as it stands. Tap a free table to open an order on it."
      />

      {closed && (
        <Card className="mb-4">
          <CardBody>
            <p className="text-sm text-ink-900 font-medium">
              {floor.data?.outlet?.name} is closed.
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              Bills already open can still be settled and printed. New orders
              are refused until it reopens.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="flex gap-4 flex-wrap mb-4">
        {LEGEND.map((l) => (
          <span key={l.state} className="flex items-center gap-2 text-sm text-grey-600">
            <i className={cn("size-3.5 rounded border", l.swatch)} />
            {l.label}
          </span>
        ))}
      </div>

      {floor.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : sections.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <LayoutGrid className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-base text-ink-900 font-medium">
                No tables have been laid out yet.
              </p>
              <p className="text-sm text-grey-600 mt-1 max-w-md mx-auto leading-relaxed">
                A section is a part of the room — A/C, Non A/C, the bar — and
                tables sit inside one. Until they exist, an order carries
                whatever the waiter types.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="mb-6">
            <h2 className="text-2xs font-semibold uppercase tracking-wide text-grey-400 mb-2.5">
              {section.name}
            </h2>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
              {section.tables.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-lg border p-3 min-h-24 flex flex-col",
                    "transition-colors duration-200",
                    TILE[t.state],
                  )}
                >
                  {t.state === "blank" ? (
                    <button
                      type="button"
                      disabled={busy === t.id || Boolean(closed)}
                      onClick={() => void open(t)}
                      className={cn(
                        "flex-1 flex flex-col items-start justify-center text-left",
                        closed ? "cursor-not-allowed" : "cursor-pointer",
                      )}
                    >
                      <span className="text-base font-medium text-ink-900">
                        {t.label}
                      </span>
                      {t.seats && (
                        <span className="text-sm text-grey-500 tabular">
                          {t.seats} seats
                        </span>
                      )}
                    </button>
                  ) : (
                    <>
                      {/* Three things, in the order a person reads them
                          across a room: how long, which table, how much. */}
                      <span className="tabular text-sm text-grey-600">
                        {t.minutes} min
                      </span>
                      <span className="text-base font-medium text-ink-900">
                        {t.label}
                      </span>
                      <span className="tabular text-base font-semibold text-ink-900 mt-auto">
                        {t.payable === null ? "—" : money(t.payable)}
                      </span>

                      <div className="flex gap-1.5 mt-2">
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
                              className="size-11 grid place-items-center rounded-md border border-grey-300 bg-white text-grey-600 hover:text-ink-900 cursor-pointer transition-colors duration-200"
                            >
                              <Printer className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Open ${t.label}`}
                              onClick={() => navigate(
                                `/h/${hotelId}/till?order=${t.orderId}`)}
                              className="size-11 grid place-items-center rounded-md border border-grey-300 bg-white text-grey-600 hover:text-ink-900 cursor-pointer transition-colors duration-200"
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
    </Page>
  );
}
