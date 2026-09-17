import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Segmented,
  Skeleton, toast,
} from "@/components/ui";
import {
  addEquipment, getEquipmentOptions, type HeldAs,
} from "@/modules/equipment/data/equipment";

/* ══════════════════════════════════════════════════════════════════
   ADDING A THING TO THE REGISTER

   The owner's answers, 16 September:
     * the person adding chooses — one by one with a tag, or a count in
       one place. No amount of money decides it;
     * the tag field offers the next free number, and a printed label
       already on the item may be typed over it;
     * a category is picked from the property's own list or typed new —
       nothing is seeded;
     * a counted line's cost is PER PIECE.

   Nothing is pre-filled except the offered tag. A cost, a date or a
   supplier nobody types stays blank, and shows as a dash.
   ══════════════════════════════════════════════════════════════════ */

export function AddEquipmentDialog({ code, open, onOpenChange, onAdded }: {
  code: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (id: string) => void;
}) {
  const options = useQuery({
    queryKey: ["equipment-options", code],
    queryFn: () => getEquipmentOptions(code),
    enabled: open && !!code,
  });
  const o = options.data;

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [heldAs, setHeldAs] = useState<HeldAs>("tagged");
  const [tag, setTag] = useState("");
  const [quantity, setQuantity] = useState("");
  const [whereKind, setWhereKind] = useState<"room" | "place">("room");
  const [roomId, setRoomId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [warrantyEnds, setWarrantyEnds] = useState("");
  const [amcEnds, setAmcEnds] = useState("");
  const [status, setStatus] = useState<"in_use" | "under_repair">("in_use");
  const [busy, setBusy] = useState(false);

  /* The offered tag arrives with the options. Offered once — a label
     the person has typed is not overwritten by a refetch. */
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    if (o && !offered) { setTag(o.nextTag); setOffered(true); }
  }, [o, offered]);

  const noPlaces = (o?.places.length ?? 0) === 0;
  const where = whereKind === "room" ? roomId : locationId;
  const ready = name.trim() !== "" && where !== ""
    && (heldAs === "tagged" ? tag.trim() !== "" : quantity.trim() !== "");

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const res = await addEquipment(code, {
      name: name.trim(),
      ...(category.trim() ? { category: category.trim() } : {}),
      heldAs,
      ...(heldAs === "tagged" ? { tag: tag.trim() } : { quantity: Number(quantity) }),
      ...(whereKind === "room" ? { roomId } : { locationId }),
      ...(supplierId ? { supplierId } : {}),
      ...(purchaseDate ? { purchaseDate } : {}),
      ...(unitCost.trim() ? { unitCost: unitCost.trim() } : {}),
      ...(warrantyEnds ? { warrantyEnds } : {}),
      ...(amcEnds ? { amcEnds } : {}),
      status,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(`${name.trim()} added`);
    onAdded(res.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add an item"
        description="Something durable the property owns."
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        {options.isLoading ? (
          <Skeleton className="h-72" />
        ) : options.error ? (
          <p className="text-base text-brand-red-700">
            The rooms and places could not be loaded, so nothing can be added yet.
            {options.error instanceof Error ? ` ${options.error.message}` : ""}
          </p>
        ) : (
          <div className="space-y-3">
            <Field label="What is it" required>
              {(f) => (
                <Input {...fieldProps(f)} value={name} placeholder="Split AC 1.5 ton"
                       onChange={(e) => setName(e.target.value)} />
              )}
            </Field>

            <Field label="Category"
                   hint="Pick one this property already uses, or type a new one.">
              {(f) => (
                <>
                  <Input {...fieldProps(f)} value={category} list="equipment-categories"
                         placeholder="Appliance"
                         onChange={(e) => setCategory(e.target.value)} />
                  <datalist id="equipment-categories">
                    {o?.categories.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </>
              )}
            </Field>

            <div>
              <p className="text-sm font-medium text-ink-900 mb-1.5">How is it kept track of</p>
              <Segmented<HeldAs>
                value={heldAs}
                onChange={setHeldAs}
                options={[
                  { value: "tagged", label: "One by one, with a tag" },
                  { value: "counted", label: "A count in one place" },
                ]}
                className="flex-wrap"
              />
            </div>

            {heldAs === "tagged" ? (
              <Field label="Tag" required
                     hint="The next free number is offered. If the item already carries a printed label, type that instead.">
                {(f) => (
                  <Input {...fieldProps(f)} value={tag} onChange={(e) => setTag(e.target.value)} />
                )}
              </Field>
            ) : (
              <Field label="How many" required hint="Twelve kettles in one room is one line of 12.">
                {(f) => (
                  <Input {...fieldProps(f)} value={quantity} inputMode="numeric" placeholder="12"
                         onChange={(e) => setQuantity(e.target.value)} />
                )}
              </Field>
            )}

            <div>
              <p className="text-sm font-medium text-ink-900 mb-1.5">
                Where is it <span className="text-brand-red-700">*</span>
              </p>
              <Segmented<"room" | "place">
                value={whereKind}
                onChange={setWhereKind}
                options={[
                  { value: "room", label: "A room" },
                  { value: "place", label: "Another place" },
                ]}
              />
              <div className="mt-2">
                {whereKind === "room" ? (
                  <NativeSelect aria-label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    <option value="">Choose a room</option>
                    {o?.rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
                  </NativeSelect>
                ) : noPlaces ? (
                  <p className="text-sm text-grey-600 leading-relaxed">
                    No places other than rooms are set up at this property yet - the lobby,
                    the kitchen, the restaurant. Until they are, choose a room.
                  </p>
                ) : (
                  <NativeSelect aria-label="Place" value={locationId}
                                onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Choose a place</option>
                    {o?.places.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.kind === "store" ? " (a store)" : ""}</option>
                    ))}
                  </NativeSelect>
                )}
              </div>
            </div>

            <Field label="Status">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={status}
                              onChange={(e) => setStatus(e.target.value as "in_use" | "under_repair")}>
                  <option value="in_use">In use</option>
                  <option value="under_repair">Under repair</option>
                </NativeSelect>
              )}
            </Field>

            <Field label="Supplier"
                   hint={(o?.suppliers.length ?? 0) === 0
                     ? "No suppliers are set up at this property yet. Leave it blank."
                     : "Blank if nobody knows."}>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={supplierId}
                              disabled={(o?.suppliers.length ?? 0) === 0}
                              onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Not known</option>
                  {o?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              )}
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bought on">
                {(f) => (
                  <Input {...fieldProps(f)} type="date" value={purchaseDate}
                         onChange={(e) => setPurchaseDate(e.target.value)} />
                )}
              </Field>
              <Field label={heldAs === "counted" ? "Cost of one, in rupees" : "Cost, in rupees"}
                     hint="Blank if nobody knows. It shows a dash, never zero.">
                {(f) => (
                  <Input {...fieldProps(f)} value={unitCost} inputMode="decimal"
                         onChange={(e) => setUnitCost(e.target.value)} />
                )}
              </Field>
              <Field label="Warranty ends">
                {(f) => (
                  <Input {...fieldProps(f)} type="date" value={warrantyEnds} min={purchaseDate || undefined}
                         onChange={(e) => setWarrantyEnds(e.target.value)} />
                )}
              </Field>
              <Field label="Service contract (AMC) ends">
                {(f) => (
                  <Input {...fieldProps(f)} type="date" value={amcEnds} min={purchaseDate || undefined}
                         onChange={(e) => setAmcEnds(e.target.value)} />
                )}
              </Field>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
