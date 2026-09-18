import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Wrench, Plus, DoorClosed, Check, Receipt } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { money, dateShort } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Textarea,
  StatusPill, Segmented,
} from "@/components/ui";
import { listWorkOrders, updateWorkOrder, type WorkOrder } from "@/modules/housekeeping/data/housekeeping";
import { RepairFlow } from "@/modules/housekeeping/flows/RepairFlow";
import { RepairCosts } from "@/modules/housekeeping/flows/RepairCosts";

/* ══════════════════════════════════════════════════════════════════
   WORK ORDERS

   A dripping tap in 204. Before this the only thing the system could
   do with that was take the room out of service — which is the wrong
   answer for a tap, and costs a night's revenue.

   A WORK ORDER IS NOT A ROOM BLOCK, and the list says which orders
   took a room out rather than implying that all of them did. Most
   take none. A broken air conditioner in July does, and then there
   are two rows: the block says the room cannot be sold, this says who
   is fixing it.

   NOT EVERY ORDER IS ABOUT A ROOM. A lift, a generator, the lobby
   door — those show a dash rather than being made to invent a room.

   ORDERED BY WHAT HAS BEEN IGNORED. Urgent first, and oldest first
   within that, because a maintenance list exists to surface the thing
   nobody has picked up.

   REPAIRS ON EQUIPMENT, AND THEIR COST (phase 2B, 17 September): an
   order may name a tagged thing, which is "Under repair" while it is
   open; managers record what it cost with proof. A bill often arrives
   after the fix, so closed work has its own list — Open · Closed, the
   owner's answer — where a late cost is still recorded.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const PRIORITY: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "danger" }> = {
  urgent: { label: "Urgent", tone: "danger" },
  high:   { label: "High",   tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
  low:    { label: "Low",    tone: "neutral" },
};

type View = "open" | "closed";

export default function WorkOrdersPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("open");
  const [raising, setRaising] = useState(false);
  const [closing, setClosing] = useState<WorkOrder | null>(null);
  const [costing, setCosting] = useState<WorkOrder | null>(null);

  const work = useQuery({
    queryKey: ["work-orders", hotelId, view],
    queryFn: () => listWorkOrders(hotelId, view),
  });

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["work-orders", hotelId] });

  const start = async (order: WorkOrder) => {
    const res = await updateWorkOrder(hotelId, order.id,
      { status: order.status === "open" ? "in_progress" : "open" });
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };

  const orders = work.data?.orders ?? [];
  /* The dialog reads the order from the list, so a cost recorded in it
     shows at once rather than on the next open. */
  const costingNow = costing ? orders.find((o) => o.id === costing.id) ?? costing : null;

  return (
    <Page>
      <PageHeader
        title="Work orders"
        description="What needs fixing. Most of it does not take a room out of service."
        actions={
          <Button variant="primary" className="h-11" onClick={() => setRaising(true)}>
            <Plus className="size-4" /> Raise one
          </Button>
        }
      />

      <Segmented<View>
        className="mb-4"
        value={view}
        onChange={setView}
        options={[
          { value: "open", label: `Open${work.data ? ` ${work.data.open}` : ""}` },
          { value: "closed", label: `Closed${work.data ? ` ${work.data.closed}` : ""}` },
        ]}
      />

      {/* Four states — loading, failed, empty, full (root MEMORY 269). The
          list used to turn a failure into "Nothing outstanding". */}
      {work.isLoading ? (
        <Skeleton className="h-64" />
      ) : work.error ? (
        <Card>
          <ErrorState title="Work orders did not load" error={work.error}
                      onRetry={() => void work.refetch()} />
        </Card>
      ) : orders.length === 0 ? (
        <EmptyState
          title={view === "open" ? "Nothing outstanding" : "Nothing closed yet"}
          description={view === "open"
            ? (work.data?.closed
                ? `${work.data.closed} closed and kept - "how many times have we `
                  + `fixed this room" needs them.`
                : "Raise one when something needs fixing.")
            : "A repair shows here once it is closed, with what was done."}
        />
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              hotelId={hotelId}
              order={o}
              onStart={() => void start(o)}
              onClose={() => setClosing(o)}
              onCosts={() => setCosting(o)}
            />
          ))}
        </div>
      )}

      {view === "open" && work.data?.closed ? (
        <p className="mt-4 text-sm text-grey-500">
          {work.data.closed} closed{" "}
          {work.data.closed === 1 ? "order is" : "orders are"} kept on the
          record. A table holding only open work cannot answer how many times
          a room has been fixed this year.
        </p>
      ) : null}
      {view === "closed" && work.data && work.data.closed > work.data.closedShown ? (
        <p className="mt-4 text-sm text-grey-500">
          The {work.data.closedShown} most recently closed, of {work.data.closed}.
        </p>
      ) : null}

      <RepairFlow
        hotelId={hotelId}
        open={raising}
        onOpenChange={setRaising}
        title="Raise a work order"
        onDone={refresh}
      />
      {closing && (
        <CloseDialog hotelId={hotelId} order={closing}
                     onClose={() => setClosing(null)} onDone={refresh} />
      )}
      {costingNow && (
        <RepairCosts
          hotelId={hotelId}
          order={costingNow}
          mayRecord={work.data?.mayRecordCosts ?? false}
          open
          onOpenChange={(open) => { if (!open) setCosting(null); }}
        />
      )}
    </Page>
  );
}

function OrderCard({ hotelId, order: o, onStart, onClose, onCosts }: {
  hotelId: string; order: WorkOrder;
  onStart: () => void; onClose: () => void; onCosts: () => void;
}) {
  const p = PRIORITY[o.priority] ?? PRIORITY["normal"]!;
  const closed = o.status === "done" || o.status === "cancelled";
  return (
    <Card data-work-order={o.id}>
      <CardBody className="flex flex-wrap items-start gap-3">
        <Wrench className="size-4 mt-1 shrink-0 text-grey-500" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">{o.title}</span>
            {!closed && <StatusPill tone={p.tone}>{p.label}</StatusPill>}
            {o.status === "in_progress" && (
              <StatusPill tone="info">Being fixed</StatusPill>
            )}
            {o.status === "done" && <StatusPill tone="success">Fixed</StatusPill>}
            {o.status === "cancelled" && <StatusPill tone="neutral">Not needed</StatusPill>}
            {/* Said explicitly, because the whole point of this
                table is that most orders do NOT do this. */}
            {o.blocksRoom && (
              <StatusPill tone="warning">
                <DoorClosed className="size-3" /> Room is out
              </StatusPill>
            )}
          </p>
          {o.equipment && (
            <p className="mt-0.5 text-sm">
              <Link to={`/h/${hotelId}/equipment/${o.equipment.id}`}
                    className="inline-flex min-h-11 items-center text-brand-orange-700 hover:underline"
                    data-work-order-item>
                {o.equipment.name}
              </Link>
              <span className="text-grey-500 tabular"> · {o.equipment.tag}</span>
            </p>
          )}
          {o.detail && (
            <p className="mt-0.5 text-sm text-grey-600">{o.detail}</p>
          )}
          <p className="mt-1 text-sm text-grey-500">
            {/* A dash, not a blank. A lift is not a missing room. */}
            {o.room ? `Room ${o.room}` : "-"} · {o.category} ·{" "}
            raised {dateShort(o.raisedAt)}
            {o.raisedBy ? ` by ${o.raisedBy}` : ""}
            {closed ? (
              <> · closed {dateShort(o.closedAt)}{o.closedBy ? ` by ${o.closedBy}` : ""}</>
            ) : (
              <>
                {" · "}
                <span className={cn(o.daysOpen >= 7 && "text-warning-dark font-medium")}>
                  {o.daysOpen === 0 ? "today"
                    : `${o.daysOpen} ${o.daysOpen === 1 ? "day" : "days"} open`}
                </span>
                {o.assignedTo ? ` · ${o.assignedTo}` : " · nobody has picked it up"}
              </>
            )}
          </p>
          {closed && o.resolution && (
            <p className="mt-0.5 text-sm text-grey-600">{o.resolution}</p>
          )}
          {/* THE MONEY, only where the list sent it (the owner, 17 September).
              A repair nobody recorded a cost for is a dash, never ₹0. */}
          {o.costs !== undefined && (
            <p className="mt-1 text-sm text-ink-900 tabular" data-work-order-cost>
              Cost {o.costTotal == null ? "-" : money(o.costTotal)}
            </p>
          )}
        </div>
        {/* Under the text on a phone, beside it on a desk: one button on the
            right squeezed the sentence to half a 375px card. */}
        <div className="flex flex-wrap gap-2 w-full pl-7 sm:w-auto sm:pl-0 sm:shrink-0">
          {o.costs !== undefined && (
            <Button variant="secondary" className="h-11" onClick={onCosts}>
              <Receipt className="size-4" /> Costs
            </Button>
          )}
          {!closed && (
            <>
              <Button variant="secondary" className="h-11" onClick={onStart}>
                {o.status === "open" ? "Start" : "Put back"}
              </Button>
              <Button variant="secondary" className="h-11" onClick={onClose}>
                <Check className="size-4" /> Close
              </Button>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function CloseDialog({ hotelId, order, onClose, onDone }: {
  hotelId: string; order: WorkOrder; onClose: () => void; onDone: () => void;
}) {
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = async (status: "done" | "cancelled") => {
    setBusy(true);
    const res = await updateWorkOrder(hotelId, order.id,
      { status, resolution: resolution.trim() });
    setBusy(false);
    if (!res.ok) return toast.error("Not closed", res.reason);
    toast.success(status === "done" ? "Closed" : "Cancelled",
      order.equipment
        ? `${order.title}. ${order.equipment.name} is back in use once no other repair on it is open.`
        : order.title);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={order.title}
                     description={order.room ? `Room ${order.room}` : "Not a room"}>
        <div className="space-y-4">
          <Field
            label="What was done"
            required
            hint="The line somebody reads the next time this breaks."
          >
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} value={resolution} autoFocus
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Washer replaced." />
            )}
          </Field>

          {order.equipment && (
            <p className="text-sm text-grey-600">
              Closing it puts {order.equipment.name} ({order.equipment.tag}) back in
              use - unless another repair on it is still open.
            </p>
          )}

          {order.blocksRoom && (
            <p className="text-sm text-warning-dark">
              This one took the room out of service. Closing it does not put
              the room back - do that on the room itself, so somebody decides
              rather than assuming.
            </p>
          )}

          {order.costs !== undefined && order.costTotal == null && (
            <p className="text-sm text-grey-600">
              No cost is recorded yet. A bill that arrives after this is closed
              can still be recorded under Closed.
            </p>
          )}

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="secondary" className="h-12"
                    disabled={busy || !resolution.trim()}
                    onClick={() => void finish("cancelled")}>
              Not needed
            </Button>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || !resolution.trim()}
                    onClick={() => void finish("done")}>
              Fixed
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
