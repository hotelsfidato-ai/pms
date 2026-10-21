import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, GlassWater, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { money, dateShort, bottlesAndMl } from "@/lib/format";
import {
  Card, CardBody, Button, Skeleton, EmptyState, ErrorState, Dialog, DialogContent,
  Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import {
  barBills, barDrinks, recordBarBill, attachBarBillPhoto, barBillPhoto,
  type BarBill, type BarDrink, type NewBillLine,
} from "@/modules/purchasing/data/barBills";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · BAR (the owner's D27-354)

   The bar's bills, newest first, each with its drinks, its total and its
   photo; and Record a bar bill: the supplier, the bill's number and date, a
   photo of it, and each drink - picked from the bar's list or added as
   another drink - with the bottles and the cost per bottle as paid. Saving
   puts the drinks in the bar's store at once. No approval: the bill has come.
   ══════════════════════════════════════════════════════════════════ */

const total = (b: BarBill) =>
  b.lines.every((l) => l.unitCost !== null)
    ? b.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0) : null;

export function BarBills({ hotelId, mayRecord, recording, onRecording }: {
  hotelId: string; mayRecord: boolean; recording: boolean; onRecording: (open: boolean) => void;
}) {
  const bills = useQuery({ queryKey: ["bar-bills", hotelId], queryFn: () => barBills(hotelId) });
  const drinks = useQuery({ queryKey: ["bar-drinks", hotelId], queryFn: () => barDrinks(hotelId) });
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);

  const showPhoto = async (b: BarBill) => {
    const got = await barBillPhoto(hotelId, b.photoId!);
    if (!got.ok) return void toast.error("Not opened", got.reason);
    setPhoto({ url: got.url, title: `Bill ${b.billNo} from ${b.supplier}` });
  };

  return (
    <div className="space-y-4">
      {drinks.data && !drinks.data.store && (
        <Card><CardBody className="text-sm text-grey-600">
          This hotel has no bar store, so a bar bill has nowhere to go. Mark one in Places and suppliers first.
        </CardBody></Card>
      )}

      {bills.isPending ? <Skeleton className="h-40" />
        : bills.isError ? <ErrorState title="The bar's bills did not load" onRetry={() => void bills.refetch()} />
        : bills.data.length === 0 ? (
          <EmptyState icon={<GlassWater />} title="No bar bill recorded in the last 60 days"
            description={mayRecord ? "Record a bar bill when one comes: its drinks go into the bar's store."
              : "The owner, an administrator, the GM or the Inventory Manager records them."} />
        ) : (
          <ul className="space-y-3" data-bar-bills>
            {bills.data.map((b) => (
              <li key={b.id}>
                <Card>
                  <CardBody className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="text-base font-semibold text-ink-900 flex-1 min-w-0">
                        {b.supplier} · Bill {b.billNo}
                      </p>
                      <span className="text-sm text-grey-600 tabular">{dateShort(b.billDate)}</span>
                      <span className="text-base font-medium tabular text-ink-900">
                        {total(b) === null ? "-" : money(total(b)!)}
                      </span>
                    </div>
                    <ul className="text-sm text-grey-700 space-y-0.5">
                      {b.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span>{l.item}</span>
                          <span className="tabular text-grey-600 shrink-0">
                            {bottlesAndMl(l.quantity, l.unit, null)}
                            {l.unitCost === null ? "" : ` × ${money(l.unitCost)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-grey-500">
                      <span className="flex-1">Recorded by {b.recordedBy ?? "-"} · {b.recordedAt}</span>
                      {b.photoId
                        ? <Button size="sm" variant="secondary" leadingIcon={<ImageIcon />}
                            onClick={() => void showPhoto(b)}>Photo of the bill</Button>
                        : <span>No photo</span>}
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}

      {recording && drinks.data?.store && (
        <RecordDialog hotelId={hotelId} drinks={drinks.data.drinks} onClose={() => onRecording(false)} />
      )}

      <Dialog open={photo !== null} onOpenChange={(o) => { if (!o) setPhoto(null); }}>
        <DialogContent title={photo?.title ?? ""} className="max-w-3xl">
          {photo && <img src={photo.url} alt={photo.title} className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-grey-600">{label}</span>
      {children}
    </div>
  );
}

type Draft = {
  itemId: string;            /* "" not picked; "new" another drink */
  name: string; sizeMl: string; unit: string;
  bottles: string; cost: string;
};
const EMPTY: Draft = { itemId: "", name: "", sizeMl: "", unit: "bottle", bottles: "", cost: "" };
const UNITS = ["bottle", "can", "packet", "piece"];

function RecordDialog({ hotelId, drinks, onClose }: {
  hotelId: string; drinks: BarDrink[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const sum = lines.reduce((s, l) => s + (Number(l.bottles) || 0) * (Number(l.cost) || 0), 0);

  const submit = async () => {
    setProblem(null);
    const out: NewBillLine[] = [];
    for (const l of lines) {
      if (!l.itemId) return setProblem("Pick each drink, or choose Add another drink.");
      if (l.bottles.trim() === "" || l.cost.trim() === "") {
        return setProblem("Type how many came and the cost of each, as on the bill.");
      }
      const common = { bottles: Number(l.bottles), costPerBottle: Number(l.cost) };
      out.push(l.itemId === "new"
        ? { newDrink: { name: l.name.trim(), unit: l.unit, sizeMl: l.sizeMl.trim() === "" ? null : Number(l.sizeMl) }, ...common }
        : { itemId: l.itemId, ...common });
    }
    setSaving(true);
    const res = await recordBarBill(hotelId, { supplier, billNo, billDate, lines: out });
    if (!res.ok) { setSaving(false); return setProblem(res.reason); }
    const photo = file ? await attachBarBillPhoto(hotelId, res.id, file) : { ok: true as const };
    setSaving(false);
    void qc.invalidateQueries({ queryKey: ["bar-bills", hotelId] });
    void qc.invalidateQueries({ queryKey: ["bar-drinks", hotelId] });
    onClose();
    if (photo.ok) toast.success(`Bill ${billNo.trim()} recorded`, "Its drinks are in the bar's store.");
    else toast.error(`Bill ${billNo.trim()} recorded, without its photo`, photo.reason);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Record a bar bill"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>Save the bill</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier">
              {(p) => <Input {...fieldProps(p)} value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
            </Field>
            <Field label="Bill number">
              {(p) => <Input {...fieldProps(p)} value={billNo} onChange={(e) => setBillNo(e.target.value)} />}
            </Field>
            <Field label="Bill date">
              {(p) => <Input {...fieldProps(p)} type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />}
            </Field>
          </div>

          <Field label="Photo of the bill" hint="Take it with the phone's camera, or pick a file.">
            {(p) => (
              <label className="flex items-center gap-2 text-sm text-ink-900 cursor-pointer">
                <Camera className="size-4 text-grey-500" />
                <input id={p.id} aria-describedby={p.describedBy} type="file" accept="image/*,application/pdf" capture="environment"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
              </label>
            )}
          </Field>

          <div className="space-y-3">
            <p className="text-sm font-medium text-grey-700">The drinks on the bill</p>
            {lines.map((l, i) => (
              <div key={i} className="rounded-md border border-grey-200 p-3 space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <NativeSelect aria-label={`Drink on line ${i + 1}`} value={l.itemId}
                      onChange={(e) => set(i, { itemId: e.target.value })}>
                      <option value="">Pick a drink</option>
                      {drinks.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}{d.sizeMl ? ` (${d.sizeMl} ml)` : ""}</option>
                      ))}
                      <option value="new">Add another drink…</option>
                    </NativeSelect>
                  </div>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLines((all) => all.filter((_, n) => n !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                {/* Each box keeps its name in sight once it is filled: "24" and
                    "140" side by side say nothing on their own. */}
                {l.itemId === "new" && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_110px_120px]">
                    <LineBox label="Name, as on the bill">
                      <Input aria-label={`New drink's name on line ${i + 1}`}
                        value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
                    </LineBox>
                    <LineBox label="Size, ml">
                      <Input aria-label={`Size in ml on line ${i + 1}`} inputMode="numeric"
                        value={l.sizeMl} onChange={(e) => set(i, { sizeMl: e.target.value })} />
                    </LineBox>
                    <LineBox label="Counted in">
                      <NativeSelect aria-label={`Counted in, on line ${i + 1}`} value={l.unit}
                        onChange={(e) => set(i, { unit: e.target.value })}>
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </NativeSelect>
                    </LineBox>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <LineBox label="How many">
                    <Input aria-label={`How many on line ${i + 1}`} inputMode="decimal"
                      value={l.bottles} onChange={(e) => set(i, { bottles: e.target.value })} />
                  </LineBox>
                  <LineBox label="Cost of each, ₹">
                    <Input aria-label={`Cost of each on line ${i + 1}`} inputMode="decimal"
                      value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
                  </LineBox>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button variant="secondary" size="sm" leadingIcon={<Plus />}
                onClick={() => setLines((all) => [...all, { ...EMPTY }])}>Add a drink</Button>
              <span className="text-base font-medium tabular text-ink-900">Total {money(sum)}</span>
            </div>
          </div>

          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
