import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateLong } from "@/lib/format";
import {
  Button, Dialog, DialogClose, DialogContent, Field, fieldProps, Input, Textarea, toast,
} from "@/components/ui";
import {
  cancelRepairCost, proofAddress, recordRepairCost, type WorkOrder, type RepairCost,
} from "@/modules/housekeeping/data/housekeeping";
import { COST_RECORDERS_WORDS } from "@/modules/housekeeping/repairRoles";

/* ══════════════════════════════════════════════════════════════════
   WHAT A REPAIR COST — and the proof for each figure

   The owner, 17 September:
     D17-5  the Hotel Manager, Inventory Manager, GM, admin and owner record it
     D17-6  no approval — but never without proof: a photo or screenshot of
            the bill, the payment or the transaction
     asked  several costs on one repair, each with its own proof
     asked  a wrong one is cancelled with a reason, and stays on the record
     asked  only those five and the accountant see the money

   Opened only for somebody who may see money: the list sends no `costs` to
   anybody else, so this dialog never has a figure to hide.
   ══════════════════════════════════════════════════════════════════ */

export function RepairCosts({
  hotelId, order, mayRecord, open, onOpenChange,
}: {
  hotelId: string;
  order: WorkOrder;
  mayRecord: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  const costs = order.costs ?? [];

  const record = async () => {
    setBusy(true);
    const res = await recordRepairCost(hotelId, {
      workOrderId: order.id, amount: amount.trim(), note: note.trim(), file,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Cost not recorded", res.reason);
    toast.success("Cost recorded", `${order.title} · ${amount.trim()}`);
    setAmount(""); setNote(""); setFile(null); setFileKey((k) => k + 1);
    await qc.invalidateQueries({ queryKey: ["work-orders"] });
    await qc.invalidateQueries({ queryKey: ["item-repairs"] });
  };

  const cancel = async (cost: RepairCost) => {
    setBusy(true);
    const res = await cancelRepairCost(hotelId, cost.id, why.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not cancelled", res.reason);
    toast.success("Cost cancelled", "It stays on the record, out of the total.");
    setCancelling(null); setWhy("");
    await qc.invalidateQueries({ queryKey: ["work-orders"] });
    await qc.invalidateQueries({ queryKey: ["item-repairs"] });
  };

  const openProof = async (cost: RepairCost) => {
    /* Opened BEFORE the fetch, so a phone's popup blocker sees a tap, not a
       script opening a window a second later. */
    const tab = window.open("about:blank", "_blank");
    const res = await proofAddress(hotelId, cost.proof.id);
    if (!res.ok) {
      tab?.close();
      return toast.error("Proof not opened", res.reason);
    }
    if (tab) tab.location.href = res.url;
    else window.location.assign(res.url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Costs · ${order.title}`}
        description={order.costTotal == null
          ? "Nothing recorded yet."
          : `${money(order.costTotal)} recorded, each with its proof.`}
      >
        <div className="space-y-4">
          {costs.length > 0 && (
            <ul className="divide-y divide-grey-200 rounded-md border border-grey-200" data-repair-costs>
              {costs.map((k) => (
                <li key={k.id} className="p-3 space-y-1.5" data-repair-cost={k.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn("text-base tabular text-ink-900", k.cancelled && "line-through text-grey-500")}>
                      {moneyPrecise(k.amount)}
                    </span>
                    <span className="text-sm text-grey-500">
                      {dateLong(k.recordedAt)} · {k.recordedBy ?? "-"}
                    </span>
                  </div>
                  {k.note && <p className="text-sm text-grey-600">{k.note}</p>}
                  {k.cancelled && (
                    <p className="text-sm text-grey-600">
                      Cancelled {dateLong(k.cancelled.at)} by {k.cancelled.by ?? "-"}: {k.cancelled.reason}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" className="h-11" onClick={() => void openProof(k)}>
                      <FileText className="size-4" /> See the proof
                    </Button>
                    {mayRecord && !k.cancelled && cancelling !== k.id && (
                      <Button variant="ghost" className="h-11"
                              onClick={() => { setCancelling(k.id); setWhy(""); }}>
                        Cancel this cost
                      </Button>
                    )}
                  </div>
                  {cancelling === k.id && (
                    <div className="space-y-2 pt-1">
                      <Field label="Why is it cancelled?" required
                             hint="It stays on the record with this reason, out of the total.">
                        {(f) => (
                          <Input {...fieldProps(f)} value={why} autoFocus
                            onChange={(e) => setWhy(e.target.value)}
                            placeholder="Typed an extra zero" className="h-12 text-base" />
                        )}
                      </Field>
                      <div className="flex gap-2">
                        <Button variant="secondary" className="h-11 flex-1"
                                onClick={() => setCancelling(null)}>
                          Keep it
                        </Button>
                        <Button variant="danger" className="h-11 flex-1"
                                disabled={busy || !why.trim()} onClick={() => void cancel(k)}>
                          Cancel the cost
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {mayRecord ? (
            <div className="space-y-3" data-repair-record>
              <p className="text-sm font-medium text-ink-900">Record a cost</p>
              <Field label="Amount, in rupees" required>
                {(f) => (
                  <Input {...fieldProps(f)} value={amount} inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="1800" className="h-12 text-base tabular" />
                )}
              </Field>
              <Field label="Proof" required
                     hint="A photo or screenshot of the bill, the payment or the transaction. A cost is not recorded without it.">
                {(f) => (
                  <input
                    key={fileKey}
                    id={f.id}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    data-repair-proof
                    className={cn(
                      "block w-full min-h-12 text-base text-grey-700",
                      "file:mr-3 file:min-h-11 file:rounded-md file:border file:border-grey-300",
                      "file:bg-white file:px-3 file:text-base file:text-ink-900",
                    )}
                  />
                )}
              </Field>
              <Field label="Note" hint="Optional - who was paid, for what.">
                {(f) => (
                  <Textarea {...fieldProps(f)} rows={2} value={note}
                    onChange={(e) => setNote(e.target.value)} />
                )}
              </Field>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
                </DialogClose>
                <Button variant="primary" className="h-12 flex-1"
                        disabled={busy || !amount.trim() || !file}
                        onClick={() => void record()}>
                  Record the cost
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-grey-600">
              Recording a cost is for {COST_RECORDERS_WORDS}.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
