import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Gift } from "lucide-react";
import { money } from "@/lib/format";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, toast,
} from "@/components/ui";
import {
  stayInclusions, addStayInclusion, removeStayInclusion, listInclusions,
  type Stay,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   WHAT THIS BOOKING WAS PROMISED

   A rate is not only a number. "3,400 with breakfast for two and the
   airport pickup" is one price and three promises, and until now only
   the price was written down — `meal_plan` carried CP or MAP and
   stopped there. A guest arriving at midnight asking about their
   transfer met a desk with nothing to check.

   A DASH IS NOT A ZERO, here more than anywhere. An inclusion with no
   rate is INCLUDED — that is what the word means — and one with a rate
   is something the desk may add and bill. The same airport pickup is
   both, depending on who booked, which is why one row serves them and
   the price is snapshotted onto the stay.
   ══════════════════════════════════════════════════════════════════ */

export function InclusionsFlow({
  hotelId, stay, open, onOpenChange,
}: {
  hotelId: string; stay: Stay; open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const lines = useQuery({
    queryKey: ["stay-inclusions", hotelId, stay.id],
    queryFn: () => stayInclusions(hotelId, stay.id),
    enabled: open,
  });
  const catalogue = useQuery({
    queryKey: ["inclusions", hotelId],
    queryFn: () => listInclusions(hotelId),
    enabled: open,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["stay-inclusions", hotelId, stay.id] });
  };

  const add = async () => {
    if (busy) return;
    setBusy(true);
    const res = await addStayInclusion(hotelId, stay.id, {
      ...(pick ? { inclusionId: pick } : { name: name.trim() }),
      quantity: Number(qty) || 1,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    setAdding(false);
    setPick("");
    setName("");
    setQty("1");
    refresh();
  };

  const drop = async (lineId: string) => {
    const res = await removeStayInclusion(hotelId, stay.id, lineId);
    if (!res.ok) return toast.error("Not removed", res.reason);
    refresh();
  };

  const ready = pick || name.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="What this booking includes"
        description={`${stay.guest} · ${stay.reference}`}
        footer={
          <Button variant="secondary" className="h-11"
                  onClick={() => onOpenChange(false)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          {(lines.data ?? []).length === 0 && !adding ? (
            <div className="rounded-md border border-dashed border-grey-300
                            bg-grey-50 p-4 text-center">
              <Gift className="size-5 text-grey-300 mx-auto mb-2" />
              <p className="text-base text-ink-900">Nothing recorded</p>
              <p className="text-sm text-grey-500 mt-1 leading-relaxed">
                The rate plan is {stay.ratePlan}. Anything promised beyond it
                — a pickup, a cake, a late checkout — belongs here so the
                next person on the desk can see it.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(lines.data ?? []).map((l) => (
                <li key={l.id}
                    className="flex items-start gap-2.5 rounded-md border
                               border-grey-200 bg-white p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base text-ink-900">{l.name}</span>
                      {l.quantity > 1 && (
                        <span className="text-sm tabular text-grey-500">
                          × {l.quantity}
                        </span>
                      )}
                      {/* INCLUDED is the answer when there is no rate,
                          and it is not the same as costing zero. */}
                      {l.rate === null
                        ? <StatusPill tone="success">Included</StatusPill>
                        : <span className="text-sm tabular text-ink-900">
                            {money(l.rate * l.quantity)}
                          </span>}
                    </div>
                    <p className="text-sm text-grey-500 mt-0.5">
                      {l.addedBy} · {l.at}
                      {l.notes ? ` · ${l.notes}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void drop(l.id)}
                    aria-label={`Remove ${l.name}`}
                    className="size-11 -m-1 grid place-items-center rounded-md
                               text-grey-400 hover:text-brand-red
                               hover:bg-red-50 cursor-pointer shrink-0"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <div className="rounded-md border border-grey-200 bg-grey-50 p-3
                            space-y-3">
              {(catalogue.data ?? []).length > 0 && (
                <Field label="From the list">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={pick}
                                  onChange={(e) => setPick(e.target.value)}>
                      <option value="">Something else</option>
                      {(catalogue.data ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.rate === null ? " — included" : ` — ${money(i.rate)}`}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              )}
              {!pick && (
                <Field label="What was promised" required
                       hint="Anything agreed at the desk. It does not have to be on the list.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={name}
                           placeholder="Airport pickup, 06:10 arrival"
                           onChange={(e) => setName(e.target.value)} />
                  )}
                </Field>
              )}
              <Field label="How many">
                {(f) => (
                  <Input {...fieldProps(f)} value={qty} inputMode="numeric"
                         onChange={(e) => setQty(e.target.value)} />
                )}
              </Field>
              <div className="flex gap-2">
                <Button className="h-11" disabled={!ready || busy}
                        onClick={() => void add()}>
                  {busy ? "Adding…" : "Add"}
                </Button>
                <Button variant="secondary" className="h-11"
                        onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="h-11 w-full"
                    onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add an inclusion
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
