import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Wrench, Plus, DoorClosed, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea,
  NativeSelect, StatusPill,
} from "@/components/ui";
import { listWorkOrders, raiseWorkOrder, updateWorkOrder, type WorkOrder } from "@/modules/housekeeping/data/housekeeping";

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

const CATEGORIES = [
  "maintenance", "housekeeping", "electrical", "plumbing",
  "furniture", "it", "other",
];

export default function WorkOrdersPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [raising, setRaising] = useState(false);
  const [closing, setClosing] = useState<WorkOrder | null>(null);

  const work = useQuery({
    queryKey: ["work-orders", hotelId],
    queryFn: () => listWorkOrders(hotelId),
  });

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["work-orders", hotelId] });

  const start = async (order: WorkOrder) => {
    const res = await updateWorkOrder(hotelId, order.id,
      { status: order.status === "open" ? "in_progress" : "open" });
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };

  if (work.isLoading) {
    return (
      <Page>
        <PageHeader title="Work orders" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  const orders = work.data?.orders ?? [];

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

      {orders.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          description={work.data?.closed
            ? `${work.data.closed} closed and kept — "how many times have we `
              + `fixed this room" needs them.`
            : "Raise one when something needs fixing."}
        />
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const p = PRIORITY[o.priority] ?? PRIORITY["normal"]!;
            return (
              <Card key={o.id}>
                <CardBody className="flex flex-wrap items-start gap-3">
                  <Wrench className="size-4 mt-1 shrink-0 text-grey-500" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-medium">{o.title}</span>
                      <StatusPill tone={p.tone}>{p.label}</StatusPill>
                      {o.status === "in_progress" && (
                        <StatusPill tone="info">Being fixed</StatusPill>
                      )}
                      {/* Said explicitly, because the whole point of this
                          table is that most orders do NOT do this. */}
                      {o.blocksRoom && (
                        <StatusPill tone="warning">
                          <DoorClosed className="size-3" /> Room is out
                        </StatusPill>
                      )}
                    </p>
                    {o.detail && (
                      <p className="mt-0.5 text-sm text-grey-600">{o.detail}</p>
                    )}
                    <p className="mt-1 text-sm text-grey-500">
                      {/* A dash, not a blank. A lift is not a missing room. */}
                      {o.room ? `Room ${o.room}` : "—"} · {o.category} ·{" "}
                      raised {o.raisedAt}
                      {o.raisedBy ? ` by ${o.raisedBy}` : ""} ·{" "}
                      <span className={cn(o.daysOpen >= 7 && "text-warning-dark font-medium")}>
                        {o.daysOpen === 0 ? "today"
                          : `${o.daysOpen} ${o.daysOpen === 1 ? "day" : "days"} open`}
                      </span>
                      {o.assignedTo ? ` · ${o.assignedTo}` : " · nobody has picked it up"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="secondary" className="h-11"
                            onClick={() => void start(o)}>
                      {o.status === "open" ? "Start" : "Put back"}
                    </Button>
                    <Button variant="secondary" className="h-11"
                            onClick={() => setClosing(o)}>
                      <Check className="size-4" /> Close
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {work.data?.closed ? (
        <p className="mt-4 text-sm text-grey-500">
          {work.data.closed} closed{" "}
          {work.data.closed === 1 ? "order is" : "orders are"} kept on the
          record. A table holding only open work cannot answer how many times
          a room has been fixed this year.
        </p>
      ) : null}

      {raising && (
        <RaiseDialog hotelId={hotelId} onClose={() => setRaising(false)}
                     onDone={refresh} />
      )}
      {closing && (
        <CloseDialog hotelId={hotelId} order={closing}
                     onClose={() => setClosing(null)} onDone={refresh} />
      )}
    </Page>
  );
}

function RaiseDialog({ hotelId, onClose, onDone }: {
  hotelId: string; onClose: () => void; onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [room, setRoom] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState("maintenance");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await raiseWorkOrder(hotelId, {
      title: title.trim(), detail: detail.trim(),
      category, priority,
      ...(room.trim() ? { roomNumber: room.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not raised", res.reason);
    toast.success("Raised", title.trim());
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Raise a work order"
                     description="It does not take the room out of service. Block the room separately if it has to come out.">
        <div className="space-y-4">
          <Field label="What needs fixing" required>
            {(f) => (
              <Input {...fieldProps(f)} value={title} autoFocus
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Dripping tap in the bathroom"
                className="h-12 text-base" />
            )}
          </Field>

          <Field label="Room"
                 hint="Leave empty for anything that is not a room — a lift, the lobby.">
            {(f) => (
              <Input {...fieldProps(f)} value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="204" className="h-12 text-base" />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-12 text-base">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Priority">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="h-12 text-base">
                  {Object.entries(PRIORITY).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>

          <Field label="Anything else" hint="Optional.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={2} value={detail}
                onChange={(e) => setDetail(e.target.value)} />
            )}
          </Field>

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1" disabled={busy || !title.trim()}
                    onClick={() => void submit()}>
              Raise it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
    toast.success(status === "done" ? "Closed" : "Cancelled", order.title);
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

          {order.blocksRoom && (
            <p className="text-sm text-warning-dark">
              This one took the room out of service. Closing it does not put
              the room back — do that on the room itself, so somebody decides
              rather than assuming.
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
