import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeldError } from "@/lib/api";
import { dateLong } from "@/lib/format";
import {
  Button, Checkbox, Dialog, DialogClose, DialogContent, Field, fieldProps, Input,
  NativeSelect, Textarea, toast,
} from "@/components/ui";
import { BLOCK_REASONS, BUSINESS_DATE } from "@/data/repositories";
import {
  blockRoomForRepair, listRepairableEquipment, raiseWorkOrder,
} from "@/modules/housekeeping/data/housekeeping";

/* ══════════════════════════════════════════════════════════════════
   REPORT A REPAIR — one dialog, wherever a repair starts

   From the room card's "Repair" (the owner, D17-8 and the answer of
   17 September: it reports a repair for that room, and taking the room
   out of service is offered inside it), from Work orders' "Raise one",
   and from a piece of equipment's own page.

   One component, because two copies of one form are how two screens come
   to disagree about what a repair is (root MEMORY 248).

   MOST REPAIRS DO NOT TAKE THE ROOM OUT. A dripping tap does not cost a
   night's sale, so taking the room out is a second, deliberate choice —
   unticked until somebody ticks it.

   A PIECE OF EQUIPMENT (phase 2B) is optional, and only a TAGGED thing is
   offered (the owner, 17 September). Raising the repair makes it "Under
   repair"; closing the last repair on it makes it "In use" again (D17-7).
   A thing waiting in the approvals inbox is shown and cannot be picked,
   with the reason — the server refuses it the same way.
   ══════════════════════════════════════════════════════════════════ */

const PRIORITIES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export const REPAIR_KINDS = [
  "maintenance", "housekeeping", "electrical", "plumbing",
  "furniture", "it", "other",
];

export interface RepairFlowProps {
  hotelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's heading. */
  title: string;
  description?: string;
  /** Filled in and fixed when the repair starts from a room. */
  room?: { number: string; occupied: boolean };
  /** Filled in and fixed when the repair starts from a piece of equipment. */
  item?: { id: string; name: string; tag: string; roomNumber: string | null };
  /** Shown only from a room: out of service with no repair (NC, refurbishment). */
  onOutOfServiceOnly?: () => void;
  onDone?: () => void;
}

export function RepairFlow({
  hotelId, open, onOpenChange, title, description, room, item, onOutOfServiceOnly, onDone,
}: RepairFlowProps) {
  const qc = useQueryClient();
  const [what, setWhat] = useState("");
  const [roomNumber, setRoomNumber] = useState(room?.number ?? item?.roomNumber ?? "");
  const [itemId, setItemId] = useState(item?.id ?? "");
  const [kind, setKind] = useState("maintenance");
  const [priority, setPriority] = useState("normal");
  const [detail, setDetail] = useState("");
  const [takeOut, setTakeOut] = useState(false);
  const [reason, setReason] = useState<string>("out_of_order");
  const [from, setFrom] = useState(BUSINESS_DATE);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  /* A fresh form each time it opens: yesterday's half-typed repair is not
     today's. */
  useEffect(() => {
    if (!open) return;
    setWhat(""); setDetail(""); setKind("maintenance"); setPriority("normal");
    setRoomNumber(room?.number ?? item?.roomNumber ?? "");
    setItemId(item?.id ?? "");
    setTakeOut(false); setReason("out_of_order"); setFrom(BUSINESS_DATE); setUntil("");
  }, [open, room?.number, item?.id, item?.roomNumber]);

  const equipment = useQuery({
    queryKey: ["repairable-equipment", hotelId],
    queryFn: () => listRepairableEquipment(hotelId),
    enabled: open && !item,
  });

  /* The things in THIS room first — a housekeeper at room 204 is reporting
     204's AC, not the lobby's. */
  const here = roomNumber.trim();
  const items = [...(equipment.data?.items ?? [])].sort(
    (a, b) => Number(b.roomNumber === here) - Number(a.roomNumber === here));

  const roomGiven = here.length > 0;
  const mayTakeOut = roomGiven && !room?.occupied;

  const submit = async () => {
    setBusy(true);
    try {
      let res;
      try {
        res = await raiseWorkOrder(hotelId, {
          title: what.trim(), detail: detail.trim(), category: kind, priority,
          ...(roomGiven ? { roomNumber: here } : {}),
          ...(itemId ? { equipmentItemId: itemId } : {}),
        });
      } catch (error) {
        if (!(error instanceof HeldError)) throw error;
        /* Held on this phone. A repair can wait for the signal; taking a room
           off sale cannot be held (src/lib/offline.ts), so it is said out loud
           rather than silently dropped. */
        toast.warning("Saved on this phone", takeOut
          ? `${error.message} Taking room ${here} out of service needs the connection — do it when you are back online.`
          : error.message);
        onOpenChange(false);
        return;
      }
      if (!res.ok) {
        toast.error("Not raised", res.reason);
        return;
      }

      const picked = item ?? equipment.data?.items.find((i) => i.id === itemId);
      const said = picked ? `${picked.name} (${picked.tag}) is under repair.` : "";

      if (takeOut && mayTakeOut) {
        const out = await blockRoomForRepair(hotelId, here, {
          reason, from, to: until || null, workOrderId: res.id, note: what.trim(),
        });
        if (!out.ok) {
          /* The repair exists; the room is still on sale. Both said. */
          toast.error(`Repair raised — room ${here} was not taken out`, out.reason);
        } else {
          toast.success("Repair raised", [
            said,
            `Room ${here} is out of service${until ? ` until ${dateLong(until)}` : ", no return date set"}.`,
          ].filter(Boolean).join(" "));
        }
      } else {
        toast.success("Repair raised", said || what.trim());
      }

      await qc.invalidateQueries();
      onOpenChange(false);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const chosen = items.find((i) => i.id === itemId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description ?? "Most repairs do not take the room out of service. If this one does, say so below."}
      >
        <div className="space-y-4">
          <Field label="What needs fixing" required>
            {(f) => (
              <Input {...fieldProps(f)} value={what} autoFocus
                onChange={(e) => setWhat(e.target.value)}
                placeholder="Dripping tap in the bathroom"
                className="h-12 text-base" />
            )}
          </Field>

          {room ? null : (
            <Field label="Room"
                   hint="Leave empty for anything that is not a room — a lift, the lobby.">
              {(f) => (
                <Input {...fieldProps(f)} value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="204" className="h-12 text-base" />
              )}
            </Field>
          )}

          {item ? (
            <p className="text-base text-ink-900" data-repair-item>
              {item.name} <span className="text-grey-500 tabular">· {item.tag}</span>
            </p>
          ) : equipment.data?.mayReport === false ? null : (
            <Field
              label="Equipment"
              hint={chosen?.status === "under_repair"
                ? "Already under repair. It stays so until every repair on it is closed."
                : "Only a tagged item can be picked. It shows as under repair until this is closed."}
            >
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  disabled={equipment.isLoading}
                  className="h-12 text-base" data-repair-equipment>
                  <option value="">
                    {equipment.isLoading ? "Loading equipment…"
                      : equipment.isError ? "Equipment did not load — not a piece of equipment"
                      : "Not a piece of equipment"}
                  </option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id} disabled={i.waiting}>
                      {i.name} · {i.tag} · {i.place}
                      {i.waiting ? " — waiting in the approvals inbox" : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={kind}
                  onChange={(e) => setKind(e.target.value)} className="h-12 text-base">
                  {REPAIR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Priority">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={priority}
                  onChange={(e) => setPriority(e.target.value)} className="h-12 text-base">
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
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

          {/* ── Taking the room out, as a second choice ─────────────── */}
          {roomGiven && (
            room?.occupied ? (
              <p className="text-sm text-grey-600">
                Somebody is in room {here}, so it cannot be taken out of service now.
              </p>
            ) : (
              <div className="rounded-md border border-grey-200 p-3 space-y-3">
                <label className="flex min-h-11 items-center gap-2.5 cursor-pointer select-none">
                  <Checkbox checked={takeOut} onCheckedChange={setTakeOut} />
                  <span className="text-base text-ink-900">
                    Take room {here} out of service too
                  </span>
                </label>
                {takeOut && (
                  <>
                    <Field label="Why is it coming out?" required>
                      {(f) => (
                        <NativeSelect {...fieldProps(f)} value={reason}
                          onChange={(e) => setReason(e.target.value)} className="h-12 text-base">
                          {BLOCK_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From" required>
                        {(f) => (
                          <Input {...fieldProps(f)} type="date" value={from}
                            onChange={(e) => setFrom(e.target.value)} className="h-12 text-base" />
                        )}
                      </Field>
                      <Field label="Until" hint="Leave empty if unknown">
                        {(f) => (
                          <Input {...fieldProps(f)} type="date" value={until} min={from}
                            onChange={(e) => setUntil(e.target.value)} className="h-12 text-base" />
                        )}
                      </Field>
                    </div>
                  </>
                )}
              </div>
            )
          )}

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-12 flex-1"
                    disabled={busy || !what.trim() || (takeOut && mayTakeOut && (!from || (!!until && until < from)))}
                    onClick={() => void submit()}>
              Raise it
            </Button>
          </div>

          {onOutOfServiceOnly && (
            <div className="border-t border-grey-200 pt-3">
              <Button variant="ghost" className="h-11 w-full"
                      onClick={() => { onOpenChange(false); onOutOfServiceOnly(); }}>
                Out of service without a repair
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
