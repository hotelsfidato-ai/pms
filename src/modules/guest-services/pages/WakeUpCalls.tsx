import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { AlarmClock, Check, Plus } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateShort } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, NativeSelect, Textarea,
  StatusPill, Segmented, IconChip,
} from "@/components/ui";
import { actOnWakeUp, listWakeUps, setWakeUp, type InHouse, type WakeUpCall } from "@/modules/guest-services/data/wakeAndLost";

/* ══════════════════════════════════════════════════════════════════
   WAKE-UP CALLS (D27-239; the owner's answers D27-241)

   The desk sets one; a guest may ask from their own page, and it waits here
   until the desk confirms it. Due from fifteen minutes before until marked
   done (the bell says so too); no "missed" state. Every time is the
   hotel's own clock.
   ══════════════════════════════════════════════════════════════════ */

type View = "open" | "done";
const when = (callAt: string) => `${dateShort(callAt.slice(0, 10))}, ${callAt.slice(11, 16)}`;

export default function WakeUpCallsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const code = params["code"] ?? fallback;
  const qc = useQueryClient();
  const [view, setView] = useState<View>("open");
  const [setting, setSetting] = useState(false);
  const [cancelling, setCancelling] = useState<WakeUpCall | null>(null);

  const list = useQuery({
    queryKey: ["wake-up-calls", code, view],
    queryFn: () => listWakeUps(code, view),
    refetchInterval: 30_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["wake-up-calls", code] });
  const act = async (w: WakeUpCall, action: "confirm" | "done") => {
    const res = await actOnWakeUp(code, w.id, action);
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };
  const calls = list.data?.calls ?? [];

  return (
    <Page>
      <PageHeader
        title="Wake-up calls"
        description="Calls to make, on the hotel's clock. Due from fifteen minutes before."
        actions={<Button variant="primary" className="h-11" onClick={() => setSetting(true)}>
          <Plus className="size-4" /> Set a call</Button>}
      />
      <Segmented<View> className="mb-5" value={view} onChange={setView}
        options={[{ value: "open", label: "To make" }, { value: "done", label: "Done, last 24 h" }]} />

      {list.isLoading ? <Skeleton className="h-48" />
        : list.error ? <Card><ErrorState title="Wake-up calls did not load" error={list.error}
                                         onRetry={() => void list.refetch()} /></Card>
        : calls.length === 0 ? (
          <EmptyState title={view === "open" ? "No calls to make" : "Nothing done in the last 24 hours"}
            description={view === "open"
              ? "A call shows here when the desk sets one, or when a guest asks on their own page."
              : "A call shows here once it is made or cancelled, with who and when."} />
        ) : (
          <div className="space-y-3">
            {calls.map((w) => (
              <Card key={w.id} data-wake-up={w.id}>
                <CardBody className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
                  <IconChip className="mt-px" tone={w.due ? "orange" : "neutral"}><AlarmClock /></IconChip>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-medium tabular-nums">{when(w.callAt)}</span>
                      {w.due && <StatusPill tone="warning">Due</StatusPill>}
                      {w.status === "asked" && <StatusPill tone="info">Asked</StatusPill>}
                      {w.status === "done" && <StatusPill tone="success">Done</StatusPill>}
                      {w.status === "cancelled" && <StatusPill tone="neutral">Cancelled</StatusPill>}
                    </p>
                    <p className="mt-1 text-sm text-grey-500">
                      {w.room ? `Room ${w.room}` : "-"}{w.guest ? ` · ${w.guest}` : ""}
                      {w.fromGuest ? " · asked from the guest's page" : w.setBy ? ` · set by ${w.setBy}` : ""}
                      {w.handledBy ? ` · ${w.status === "done" ? "called" : "cancelled"} by ${w.handledBy}` : ""}
                    </p>
                    {w.note && <p className="mt-0.5 text-sm text-grey-600">{w.note}</p>}
                    {w.cancelReason && <p className="mt-0.5 text-sm text-grey-600">{w.cancelReason}</p>}
                  </div>
                  {(w.status === "asked" || w.status === "set") && (
                    <div className="flex flex-wrap gap-2 w-full pl-[42px] sm:w-auto sm:pl-0 sm:shrink-0">
                      {w.status === "asked" ? (
                        <Button variant="secondary" className="h-11" onClick={() => void act(w, "confirm")}>Confirm</Button>
                      ) : (
                        <Button variant="secondary" className="h-11" onClick={() => void act(w, "done")}>
                          <Check className="size-4" /> Done</Button>
                      )}
                      <Button variant="ghost" className="h-11" onClick={() => setCancelling(w)}>Cancel it</Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}

      {setting && <SetDialog code={code} rooms={list.data?.rooms ?? []} today={list.data?.today ?? ""}
                             onClose={() => setSetting(false)} onDone={refresh} />}
      {cancelling && <CancelDialog code={code} w={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />}
    </Page>
  );
}

function SetDialog({ code, rooms, today, onClose, onDone }: {
  code: string; rooms: InHouse[]; today: string; onClose: () => void; onDone: () => void;
}) {
  const [reservationId, setReservationId] = useState(rooms[0]?.reservationId ?? "");
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await setWakeUp(code, { reservationId, day, time, note });
    setBusy(false);
    if (!res.ok) return toast.error("Not set", res.reason);
    onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Set a wake-up call" description="For a guest in house now, on the hotel's clock.">
        {rooms.length === 0 ? (
          <p className="text-sm text-grey-600">Nobody is checked in, so there is nobody to call.</p>
        ) : (
          <div className="space-y-4">
            <Field label="Room" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={reservationId} onChange={(e) => setReservationId(e.target.value)}>
                  {rooms.map((r) => <option key={r.reservationId} value={r.reservationId}>
                    {r.guest ? `${r.room} · ${r.guest}` : r.room}</option>)}
                </NativeSelect>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day" required>
                {(f) => <Input {...fieldProps(f)} type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} />}
              </Field>
              <Field label="Time" required>
                {(f) => <Input {...fieldProps(f)} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
              </Field>
            </div>
            <Field label="Note" hint="Only if there is something to say on the call.">
              {(f) => <Input {...fieldProps(f)} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <DialogClose asChild><Button variant="secondary" className="h-12 flex-1">Cancel</Button></DialogClose>
              <Button variant="primary" className="h-12 flex-1" disabled={busy || !reservationId || !day || !time}
                      onClick={() => void save()}>Set the call</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ code, w, onClose, onDone }: {
  code: string; w: WakeUpCall; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    const res = await actOnWakeUp(code, w.id, "cancel", reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not cancelled", res.reason);
    onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={when(w.callAt)} description={w.room ? `Room ${w.room}` : undefined}>
        <div className="space-y-4">
          <Field label="Why it is cancelled" required>
            {(f) => <Textarea {...fieldProps(f)} rows={2} maxLength={200} value={reason} autoFocus
                              onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="secondary" className="h-12 flex-1">Back</Button></DialogClose>
            <Button variant="danger" className="h-12 flex-1" disabled={busy || !reason.trim()}
                    onClick={() => void finish()}>Cancel the call</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
