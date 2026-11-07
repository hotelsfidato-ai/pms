import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise } from "@/lib/format";
import { Button, Checkbox, Dialog, DialogContent, Field, Input, StatusPill, toast } from "@/components/ui";
import { recordMinibar, type MinibarItem } from "@/modules/housekeeping/data/housekeeping";

/* ══════════════════════════════════════════════════════════════════
   WHAT WAS TAKEN FROM A ROOM'S MINIBAR (D27-383 item 10, D27-396)

   Housekeeping when cleaning, or the desk at check-out. How many of each;
   the server puts it on the bill of the guest in the room, and issues the
   refill from the store. "Not sure" sends it to the desk instead, and so
   does a room whose guest has left - a closed bill is never added to.

   An item with no price is shown and cannot be counted: it cannot be
   charged until the hotel types its price (no default prices).
   ══════════════════════════════════════════════════════════════════ */

export function MinibarFlow({
  hotelId, room: fixedRoom, items, open, onOpenChange,
}: {
  hotelId: string;
  /** The board's card fixes the room; the Minibar page asks for it. */
  room?: string;
  items: MinibarItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [room, setRoom] = useState(fixedRoom ?? "");
  const [count, setCount] = useState<Record<string, number>>({});
  const [disputed, setDisputed] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRoom(fixedRoom ?? ""); setCount({}); setDisputed(false); setSaid(null);
  }, [open, fixedRoom]);

  const shown = items.filter((i) => i.active);
  const lines = shown.filter((i) => (count[i.id] ?? 0) > 0).map((i) => ({ itemId: i.id, quantity: count[i.id]! }));
  const total = shown.reduce((n, i) => n + (i.price ?? 0) * (count[i.id] ?? 0), 0);
  const why = !room.trim() ? "Which room?" : lines.length === 0 ? "Count what was taken first." : null;
  const step = (id: string, by: number) =>
    setCount((c) => ({ ...c, [id]: Math.max(0, Math.min(99, (c[id] ?? 0) + by)) }));

  const save = async () => {
    if (why) return setSaid(why);
    setBusy(true);
    const res = await recordMinibar(hotelId, { room: room.trim(), lines, disputed });
    setBusy(false);
    if (!res.ok) return setSaid(res.reason);
    const n = room.trim().toUpperCase();
    toast.success(res.data?.status === "charged" ? `On room ${n}'s bill. The refill is out of the store.`
      : res.data?.waitingWhy === "after_checkout" ? `Room ${n}'s guest has left: the desk decides.`
      : `Sent to the desk to confirm.`);
    await qc.invalidateQueries({ queryKey: ["minibar"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={fixedRoom ? `Minibar · Room ${fixedRoom}` : "Minibar"}
        description="How many of each were taken. It goes on the guest's bill, and the refill comes out of the store."
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              aria-disabled={why ? true : undefined}
              className={cn(why && "opacity-60")}
              disabled={busy}
              onClick={() => void save()}
              data-minibar-save
            >
              {disputed ? "Send to the desk" : "Record what was taken"}
            </Button>
          </div>
        }
      >
        {!fixedRoom && (
          <Field label="Room" required className="mb-4">
            {({ id }) => (
              <Input id={id} value={room} onChange={(e) => setRoom(e.target.value)} placeholder="204" inputMode="text" />
            )}
          </Field>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-grey-500">This hotel has no minibar list yet.</p>
        ) : (
          <ul className="divide-y divide-grey-100">
            {shown.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2" data-minibar-item={i.name}>
                <div className="min-w-0 flex-1">
                  <p className="text-base text-ink-900 truncate">{i.name}</p>
                  <p className="text-sm text-grey-500 tabular">
                    {i.price === null ? "No price yet - cannot be charged" : moneyPrecise(i.price)}
                    {i.alcohol && <> · <StatusPill tone="neutral">VAT</StatusPill></>}
                  </p>
                </div>
                {i.price !== null && (
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="icon" aria-label={`One less ${i.name}`}
                      disabled={!count[i.id]} onClick={() => step(i.id, -1)}>
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-7 text-center text-md font-semibold tabular" aria-live="polite">
                      {count[i.id] ?? 0}
                    </span>
                    <Button variant="secondary" size="icon" aria-label={`One more ${i.name}`}
                      onClick={() => step(i.id, 1)}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-3">
          <Checkbox
            checked={disputed}
            onCheckedChange={setDisputed}
            label="Not sure, or the guest says not theirs - the desk confirms it"
          />
          <p className="text-sm text-grey-600 tabular">
            {lines.length ? `${moneyPrecise(total)} before tax` : "Nothing counted yet"}
          </p>
        </div>
        <p role="status" className={cn("text-sm text-brand-red-700", said ? "mt-3" : "sr-only")} data-minibar-said>
          {said ?? ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}
