import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Segmented,
  Skeleton, Textarea, toast,
} from "@/components/ui";
import {
  getEquipmentOptions, editEquipment, moveEquipment, setEquipmentStatus, retireEquipment,
  type EquipmentItem,
} from "@/modules/equipment/data/equipment";

/* ══════════════════════════════════════════════════════════════════
   WHAT CAN HAPPEN TO ONE THING

   Edit its details · move it · mark it under repair or back in use ·
   retire it. Each is recorded by the database, with who and when; each
   dialog asks WHY where a reason helps the next person reading it.

   PART OF A COUNT. On a counted line, a move, a repair or a retirement
   may take some of the pieces rather than all of them — the owner's
   answer of 16 September. The part becomes its own line, and the two
   lines still add up.
   ══════════════════════════════════════════════════════════════════ */

interface Props {
  code: string;
  item: EquipmentItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The line the change landed on — a new one when part of a count moved. */
  onDone: (id: string) => void;
}

const useOptions = (code: string, open: boolean) =>
  useQuery({
    queryKey: ["equipment-options", code],
    queryFn: () => getEquipmentOptions(code),
    enabled: open && !!code,
  });

/** How many of a counted line. Blank means all of it. */
function CountField({ item, value, onChange, what }: {
  item: EquipmentItem; value: string; onChange: (v: string) => void; what: string;
}) {
  if (item.heldAs !== "counted" || item.quantity === 1) return null;
  return (
    <Field label={`How many of the ${item.quantity}`}
           hint={`Blank ${what} all ${item.quantity}. Fewer makes them their own line, and both lines are kept.`}>
      {(f) => (
        <Input {...fieldProps(f)} value={value} inputMode="numeric" placeholder={String(item.quantity)}
               onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

const countOf = (item: EquipmentItem, value: string): number | undefined =>
  item.heldAs === "counted" && value.trim() !== "" ? Number(value) : undefined;

/* ── Details ──────────────────────────────────────────────────────── */

export function EditItemDialog({ code, item, open, onOpenChange, onDone }: Props) {
  const options = useOptions(code, open);
  const o = options.data;

  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [tag, setTag] = useState(item.tag ?? "");
  const [supplierId, setSupplierId] = useState(item.supplierId ?? "");
  const [purchaseDate, setPurchaseDate] = useState(item.purchaseDate ?? "");
  const [unitCost, setUnitCost] = useState(item.unitCost === null ? "" : String(item.unitCost));
  const [warrantyEnds, setWarrantyEnds] = useState(item.warrantyEnds ?? "");
  const [amcEnds, setAmcEnds] = useState(item.amcEnds ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    /* Only what changed is sent, so the history names only that. A field
       emptied is sent as null — "nobody knows" — never as zero. */
    const blank = (v: string) => (v.trim() === "" ? null : v.trim());
    const changes = {
      ...(name.trim() !== item.name ? { name: name.trim() } : {}),
      ...(blank(category) !== item.category ? { category: blank(category) } : {}),
      ...(item.heldAs === "tagged" && tag.trim() !== item.tag ? { tag: tag.trim() } : {}),
      ...((supplierId || null) !== item.supplierId ? { supplierId: supplierId || null } : {}),
      ...(blank(purchaseDate) !== item.purchaseDate ? { purchaseDate: blank(purchaseDate) } : {}),
      ...(blank(unitCost) !== (item.unitCost === null ? null : String(item.unitCost))
        ? { unitCost: blank(unitCost) } : {}),
      ...(blank(warrantyEnds) !== item.warrantyEnds ? { warrantyEnds: blank(warrantyEnds) } : {}),
      ...(blank(amcEnds) !== item.amcEnds ? { amcEnds: blank(amcEnds) } : {}),
    };
    const res = await editEquipment(code, item.id, changes);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(res.changed ? "Saved" : "Nothing had changed");
    onDone(item.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Change the details"
        description={item.name}
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy || !name.trim()}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {options.isLoading ? <Skeleton className="h-64" /> : (
          <div className="space-y-3">
            <Field label="What is it" required>
              {(f) => <Input {...fieldProps(f)} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Category" hint="Pick one this property already uses, or type a new one.">
              {(f) => (
                <>
                  <Input {...fieldProps(f)} value={category} list="equipment-edit-categories"
                         onChange={(e) => setCategory(e.target.value)} />
                  <datalist id="equipment-edit-categories">
                    {o?.categories.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </>
              )}
            </Field>
            {item.heldAs === "tagged" && (
              <Field label="Tag" required>
                {(f) => <Input {...fieldProps(f)} value={tag} onChange={(e) => setTag(e.target.value)} />}
              </Field>
            )}
            <Field label="Supplier">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={supplierId}
                              disabled={(o?.suppliers.length ?? 0) === 0 && !item.supplierId}
                              onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Not known</option>
                  {item.supplierId && !o?.suppliers.some((s) => s.id === item.supplierId) && (
                    <option value={item.supplierId}>{item.supplier}</option>
                  )}
                  {o?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              )}
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bought on">
                {(f) => <Input {...fieldProps(f)} type="date" value={purchaseDate}
                               onChange={(e) => setPurchaseDate(e.target.value)} />}
              </Field>
              <Field label={item.heldAs === "counted" ? "Cost of one, in rupees" : "Cost, in rupees"}
                     hint="Blank if nobody knows. It shows a dash, never zero.">
                {(f) => <Input {...fieldProps(f)} value={unitCost} inputMode="decimal"
                               onChange={(e) => setUnitCost(e.target.value)} />}
              </Field>
              <Field label="Warranty ends">
                {(f) => <Input {...fieldProps(f)} type="date" value={warrantyEnds}
                               onChange={(e) => setWarrantyEnds(e.target.value)} />}
              </Field>
              <Field label="Service contract (AMC) ends">
                {(f) => <Input {...fieldProps(f)} type="date" value={amcEnds}
                               onChange={(e) => setAmcEnds(e.target.value)} />}
              </Field>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Moving it ────────────────────────────────────────────────────── */

export function MoveItemDialog({ code, item, open, onOpenChange, onDone }: Props) {
  const options = useOptions(code, open);
  const o = options.data;
  const [whereKind, setWhereKind] = useState<"room" | "place">(item.locationId ? "place" : "room");
  const [roomId, setRoomId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const where = whereKind === "room" ? roomId : locationId;

  const submit = async () => {
    if (busy || !where) return;
    setBusy(true);
    const res = await moveEquipment(code, item.id, {
      ...(whereKind === "room" ? { roomId } : { locationId }),
      ...(countOf(item, count) !== undefined ? { count: countOf(item, count) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not moved", res.reason);
    toast.success(res.split ? `${res.quantity} moved, as their own line` : "Moved");
    onDone(res.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Move it"
        description={`${item.name} · now in ${item.place}`}
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy || !where}
                    onClick={() => void submit()}>
              {busy ? "Moving…" : "Move"}
            </Button>
          </>
        }
      >
        {options.isLoading ? <Skeleton className="h-40" /> : (
          <div className="space-y-3">
            <Segmented<"room" | "place">
              value={whereKind}
              onChange={setWhereKind}
              options={[{ value: "room", label: "To a room" }, { value: "place", label: "To another place" }]}
            />
            {whereKind === "room" ? (
              <NativeSelect aria-label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Choose a room</option>
                {o?.rooms.filter((r) => r.id !== item.roomId)
                  .map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
              </NativeSelect>
            ) : (o?.places.length ?? 0) === 0 ? (
              <p className="text-sm text-grey-600 leading-relaxed">
                No places other than rooms are set up at this property yet.
              </p>
            ) : (
              <NativeSelect aria-label="Place" value={locationId}
                            onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose a place</option>
                {o?.places.filter((p) => p.id !== item.locationId)
                  .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            )}
            <CountField item={item} value={count} onChange={setCount} what="moves" />
            <Field label="Why" hint="Optional. It is kept with the move.">
              {(f) => <Input {...fieldProps(f)} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Under repair, or back in use ─────────────────────────────────── */

export function StatusDialog({ code, item, open, onOpenChange, onDone }: Props) {
  const to = item.status === "under_repair" ? "in_use" : "under_repair";
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await setEquipmentStatus(code, item.id, {
      status: to,
      ...(countOf(item, count) !== undefined ? { count: countOf(item, count) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(to === "under_repair" ? "Marked under repair" : "Back in use");
    onDone(res.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={to === "under_repair" ? "Mark it under repair" : "Mark it back in use"}
        description={item.name}
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : to === "under_repair" ? "Under repair" : "Back in use"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <CountField item={item} value={count} onChange={setCount} what="marks" />
          <Field label="What is wrong, or what was done" hint="Optional. It is kept with the change.">
            {(f) => <Input {...fieldProps(f)} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Retiring it ──────────────────────────────────────────────────── */

export function RetireDialog({ code, item, open, onOpenChange, onDone, waitsForApproval }: Props & {
  /** A tagged item retired by somebody without `approve` waits for the GM. */
  waitsForApproval: boolean;
}) {
  const [reason, setReason] = useState("");
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    const res = await retireEquipment(code, item.id, {
      reason: reason.trim(),
      ...(countOf(item, count) !== undefined ? { count: countOf(item, count) } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not retired", res.reason);
    toast.success(res.requested ? "Sent to the general manager" : "Retired");
    onDone(res.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={waitsForApproval ? "Ask to retire it" : "Retire it"}
        description={
          waitsForApproval
            ? `${item.name} is tagged, so retiring it waits for the general manager, the owner or an administrator.`
            : `${item.name}. It stays in the register as retired, with who, when and why — nothing is deleted.`
        }
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="danger" className="h-11" disabled={busy || !reason.trim()}
                    onClick={() => void submit()}>
              {busy ? "Sending…" : waitsForApproval ? "Ask to retire" : "Retire"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <CountField item={item} value={count} onChange={setCount} what="retires" />
          <Field label="Why" required hint="Broken beyond repair, lost, sold, given away.">
            {(f) => <Textarea {...fieldProps(f)} value={reason} rows={3}
                              onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
