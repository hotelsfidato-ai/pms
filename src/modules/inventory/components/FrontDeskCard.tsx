import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import {
  Card, Button, Skeleton, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input,
} from "@/components/ui";
import { getRoomSetup, amendFrontDesk, type FrontDeskSettings } from "@/modules/inventory/data/roomSetup";

/* ── The front desk's hours ───────────────────────────────────────
   063 gave the system an opinion about the hour a guest arrives, and
   for a few hours nothing could set it — the times and both charges
   were reachable only through a database session. Shown on Settings →
   Configuration since D27-194 (Room types before); inventory keeps the
   form and its route, and the door exports this card. */
export function FrontDeskCard({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["room-setup", hotelId],
    queryFn: () => getRoomSetup(hotelId),
  });
  if (q.isLoading) return <Skeleton className="h-20" />;
  if (!q.data) return null;
  const { frontDesk } = q.data;

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
      {/* Four level columns (label over value), two by two until
          there is room for four. */}
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 flex-1 min-w-0">
        <DeskFigure label="Rooms ready from" value={frontDesk.checkInTime} />
        <DeskFigure label="Check-out by" value={frontDesk.checkOutTime} />
        {/* A DASH, not a zero. "We do not charge for this" is a
            decision a property makes; zero is a price. */}
        <DeskFigure label="Early arrival" value={
          frontDesk.earlyCheckinCharge === null
            ? null : money(frontDesk.earlyCheckinCharge)} />
        <DeskFigure label="Late departure" value={
          frontDesk.lateCheckoutCharge === null
            ? null : money(frontDesk.lateCheckoutCharge)} />
      </dl>
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
      {editing && (
        <FrontDeskDialog hotelId={hotelId} current={frontDesk}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: ["room-setup", hotelId] });
          }} />
      )}
    </Card>
  );
}

/** One of the front desk's four figures; null is a grey dash. */
function DeskFigure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-grey-500 whitespace-nowrap">{label}</dt>
      <dd className={cn("text-md font-semibold tabular",
                        value === null ? "text-grey-500" : "text-ink-900")}>
        {value ?? "-"}
      </dd>
    </div>
  );
}

function FrontDeskDialog({
  hotelId, current, onClose, onDone,
}: {
  hotelId: string; current: FrontDeskSettings;
  onClose: () => void; onDone: () => void;
}) {
  const [cin, setCin] = useState(current.checkInTime);
  const [cout, setCout] = useState(current.checkOutTime);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await amendFrontDesk(hotelId, {
      checkInTime: cin, checkOutTime: cout,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="The front desk's hours"
        description="When rooms are ready, when they are due back, and what an exception costs."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rooms ready from" required>
              {(f) => (
                <Input {...fieldProps(f)} type="time" value={cin}
                       onChange={(e) => setCin(e.target.value)} />
              )}
            </Field>
            <Field label="Check-out by" required>
              {(f) => (
                <Input {...fieldProps(f)} type="time" value={cout}
                       onChange={(e) => setCout(e.target.value)} />
              )}
            </Field>
          </div>
          {/* The fees are set on Money › Extra charges (the owner's D27-259 Q3). */}
          <p className="text-sm text-grey-600">
            The early arrival and late departure fees are set on Settings › Money › Extra charges.
          </p>
          <p className="text-sm text-grey-500 leading-relaxed">
            A guest arriving before the first time, or leaving after the
            second, needs a reason and somebody to allow it. The charge
            reaches their folio unless it is waived, and the reason is
            kept either way.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
