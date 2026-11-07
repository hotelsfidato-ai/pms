import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, GlassWater, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { moneyPrecise as money, dateShort, bottlesAndMl } from "@/lib/format";
import {
  Card, CardBody, Button, Skeleton, EmptyState, ErrorState, Dialog, DialogContent,
  Field, fieldProps, Input, NativeSelect, Checkbox, toast,
} from "@/components/ui";
import {
  barBills, barDrinks, recordBarBill, attachBarBillPhoto, barBillPhoto, lineAmount,
  type BarBill, type BarDrink, type NewBillLine,
} from "@/modules/purchasing/data/barBills";
import { suggestedDue } from "@/modules/purchasing/data/purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · BAR (the owner's D27-354)

   The bar's bills, newest first, each as printed with its photo; and Record
   a bar bill, typed as printed (the owner, 21 October evening): the
   supplier, the bill's number, date and T.P. number, a photo, each drink -
   picked from the bar's list or added - with its MRP, cases and loose
   bottles, bottles to a case and rate per case; the handling, the TCS and
   the total printed, which the lines must make. Saving puts the bottles in
   the bar's store at once. No approval: the bill has come.
   ══════════════════════════════════════════════════════════════════ */

const casesText = (l: { cases: number; bottles: number }) =>
  [l.cases ? `${l.cases} case${l.cases === 1 ? "" : "s"}` : "", l.bottles ? `${l.bottles} loose` : ""]
    .filter(Boolean).join(" + ");

export function BarBills({ hotelId, mayRecord, recording, onRecording }: {
  hotelId: string; mayRecord: boolean; recording: boolean; onRecording: (open: boolean) => void;
}) {
  const bills = useQuery({ queryKey: ["bar-bills", hotelId], queryFn: () => barBills(hotelId) });
  const drinks = useQuery({ queryKey: ["bar-drinks", hotelId], queryFn: () => barDrinks(hotelId) });
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);

  const showPhoto = async (b: BarBill) => {
    const got = await barBillPhoto(hotelId, b.id);
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
              : "The owner, an Admin, the GM, the Inventory Manager or the bar manager records them."} />
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
                      <span className="text-sm text-grey-600 tabular">
                        {dateShort(b.billDate)}{b.tpNo ? ` · T.P. ${b.tpNo}` : ""}
                      </span>
                      <span className="text-base font-medium tabular text-ink-900">
                        {b.total === null ? "-" : money(b.total)}
                      </span>
                    </div>
                    <ul className="text-sm text-grey-700 space-y-0.5">
                      {b.lines.map((l, i) => (
                        <li key={i} className="flex flex-wrap justify-between gap-x-3">
                          <span>{l.item}{l.mrp === null ? "" : ` · MRP ${money(l.mrp)}`}</span>
                          <span className="tabular text-grey-600">
                            {casesText(l)} ({bottlesAndMl(l.cases * l.perCase + l.bottles, l.unit, null)})
                            {` at ${money(l.ratePerCase)} a case of ${l.perCase} · ${money(l.amount)}`}
                          </span>
                        </li>
                      ))}
                      {(b.handling !== null || b.tcs !== null) && (
                        <li className="text-grey-600">
                          Handling {b.handling === null ? "-" : money(b.handling)} · TCS {b.tcs === null ? "-" : money(b.tcs)}
                        </li>
                      )}
                    </ul>
                    {b.credit && (
                      <p className="text-sm text-grey-600" data-credit>
                        On credit, due {dateShort(b.credit.dueOn)}
                        {/* PUR-4: what is left on it (249), never a payment date the server no longer sends. */}
                        {Number(b.credit.owed) === 0 ? " - paid"
                          : b.total !== null && Number(b.credit.owed) < b.total ? ` - ${money(Number(b.credit.owed))} left to pay`
                          : " - not paid yet"}
                      </p>
                    )}
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
        <RecordDialog hotelId={hotelId} drinks={drinks.data.drinks} suppliers={drinks.data.suppliers ?? []}
          onClose={() => onRecording(false)} />
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
  perCase: string; cases: string; bottles: string; mrp: string; rate: string;
};
const EMPTY: Draft = {
  itemId: "", name: "", sizeMl: "", unit: "bottle", perCase: "", cases: "", bottles: "", mrp: "", rate: "",
};
const UNITS = ["bottle", "can", "packet", "piece"];

const num = (v: string) => (v.trim() === "" ? null : Number(v));
/** A typed line's figures, or null while one is missing or not a number. */
function figures(l: Draft) {
  const perCase = num(l.perCase), cases = num(l.cases) ?? 0, bottles = num(l.bottles) ?? 0, rate = num(l.rate);
  if (perCase === null || rate === null || [perCase, cases, bottles, rate].some((n) => !Number.isFinite(n))) return null;
  if (perCase < 1 || cases + bottles <= 0) return null;
  return { perCase, cases, bottles, ratePerCase: rate };
}

function RecordDialog({ hotelId, drinks, suppliers, onClose }: {
  hotelId: string; drinks: BarDrink[]; suppliers: { id: string; name: string }[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  /* From the supplier list, so one supplier never becomes two by spelling (D27-372). */
  const [supplierId, setSupplierId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [tpNo, setTpNo] = useState("");
  const [handling, setHandling] = useState("");
  const [tcs, setTcs] = useState("");
  const [printed, setPrinted] = useState("");
  /* On credit (D27-370): the bill goes on the Supplier dues, due on this date. */
  const [onCredit, setOnCredit] = useState(false);
  const [dueOn, setDueOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const amounts = lines.map((l) => { const f = figures(l); return f ? lineAmount(f) : null; });
  const made = Math.round((amounts.reduce<number>((t, a) => t + (a ?? 0), 0)
    + (Number(handling) || 0) + (Number(tcs) || 0)) * 100) / 100;
  const off = printed.trim() === "" ? null : Math.round((made - Number(printed)) * 100) / 100;

  const submit = async () => {
    setProblem(null);
    const out: NewBillLine[] = [];
    for (const l of lines) {
      if (!l.itemId) return setProblem("Pick each drink, or choose Add another drink.");
      const f = figures(l);
      if (!f) return setProblem("Type each line's bottles to a case, the cases or loose bottles, and the rate per case.");
      const common = { ...f, mrp: num(l.mrp) };
      out.push(l.itemId === "new"
        ? { newDrink: { name: l.name.trim(), unit: l.unit, sizeMl: num(l.sizeMl) }, ...common }
        : { itemId: l.itemId, ...common });
    }
    if (!supplierId) return setProblem("Who is the bill from? Pick the supplier.");
    if (printed.trim() === "") return setProblem("Type the bill's total, as printed on it.");
    if (onCredit && !dueOn) return setProblem("Pick the date the bill is due.");
    setSaving(true);
    const res = await recordBarBill(hotelId, {
      supplierId, billNo, billDate, tpNo: tpNo.trim() || null,
      handling: num(handling), tcs: num(tcs), total: Number(printed), lines: out,
      ...(onCredit ? { dueOn } : {}) });
    if (!res.ok) { setSaving(false); return setProblem(res.reason); }
    const photo = file ? await attachBarBillPhoto(hotelId, res.id, file) : { ok: true as const };
    setSaving(false);
    void qc.invalidateQueries({ queryKey: ["bar-bills", hotelId] });
    void qc.invalidateQueries({ queryKey: ["bar-drinks", hotelId] });
    void qc.invalidateQueries({ queryKey: ["bar-sheet", hotelId] });
    onClose();
    if (photo.ok) toast.success(`Bill ${billNo.trim()} recorded`, "Its bottles are in the bar's store.");
    else toast.error(`Bill ${billNo.trim()} recorded, without its photo`, photo.reason);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Record a bar bill"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>Save the bill</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">Type it as printed. The lines, the handling and the TCS must make the bill's total.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Supplier" className="sm:col-span-2">
              {(p) => (
                <NativeSelect {...fieldProps(p)} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{suppliers.length ? "Pick the supplier" : "No supplier yet: add one in Places and suppliers"}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Bill number">
              {(p) => <Input {...fieldProps(p)} value={billNo} onChange={(e) => setBillNo(e.target.value)} />}
            </Field>
            <Field label="Bill date">
              {(p) => <Input {...fieldProps(p)} type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />}
            </Field>
            <Field label="T.P. number" hint="The transport permit, if printed.">
              {(p) => <Input {...fieldProps(p)} value={tpNo} onChange={(e) => setTpNo(e.target.value)} />}
            </Field>
            <Field label="Photo of the bill" hint="Take it with the phone's camera, or pick a file." className="sm:col-span-3">
              {(p) => (
                <label className="flex items-center gap-2 text-sm text-ink-900 cursor-pointer">
                  <Camera className="size-4 text-grey-500" />
                  <input id={p.id} aria-describedby={p.describedBy} type="file" accept="image/*,application/pdf" capture="environment"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
                </label>
              )}
            </Field>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-grey-700">The drinks on the bill</p>
            {lines.map((l, i) => (
              <div key={i} className="rounded-md border border-grey-200 p-3 space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <NativeSelect aria-label={`Drink on line ${i + 1}`} value={l.itemId}
                      onChange={(e) => {
                        const d = drinks.find((x) => x.id === e.target.value);
                        set(i, { itemId: e.target.value, ...(d?.perCase && l.perCase === "" ? { perCase: String(d.perCase) } : {}) });
                      }}>
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
                {/* Each box keeps its name in sight once it is filled: "2" and
                    "48" side by side say nothing on their own. */}
                {l.itemId === "new" && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_130px_120px]">
                    <LineBox label="Brand, as on the bill">
                      <Input aria-label={`New drink's name on line ${i + 1}`}
                        value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
                    </LineBox>
                    <LineBox label="Size, ml (a NIP is 180)">
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
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 items-end">
                  <LineBox label="Bottles a case">
                    <Input aria-label={`Bottles to a case on line ${i + 1}`} inputMode="numeric"
                      value={l.perCase} onChange={(e) => set(i, { perCase: e.target.value })} />
                  </LineBox>
                  <LineBox label="Cases">
                    <Input aria-label={`Cases on line ${i + 1}`} inputMode="numeric"
                      value={l.cases} onChange={(e) => set(i, { cases: e.target.value })} />
                  </LineBox>
                  <LineBox label="Loose bottles">
                    <Input aria-label={`Loose bottles on line ${i + 1}`} inputMode="numeric"
                      value={l.bottles} onChange={(e) => set(i, { bottles: e.target.value })} />
                  </LineBox>
                  <LineBox label="MRP, ₹">
                    <Input aria-label={`MRP on line ${i + 1}`} inputMode="decimal"
                      value={l.mrp} onChange={(e) => set(i, { mrp: e.target.value })} />
                  </LineBox>
                  <LineBox label="Rate a case, ₹">
                    <Input aria-label={`Rate per case on line ${i + 1}`} inputMode="decimal"
                      value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
                  </LineBox>
                  <LineBox label="Amount">
                    <p className="h-10 flex items-center justify-end tabular text-base text-ink-900" data-line-amount>
                      {amounts[i] === null ? "-" : money(amounts[i]!)}
                    </p>
                  </LineBox>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" leadingIcon={<Plus />}
              onClick={() => setLines((all) => [...all, { ...EMPTY }])}>Add a drink</Button>
          </div>

          <div className="grid gap-3 grid-cols-3">
            <Field label="Handling charges, ₹">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={handling} onChange={(e) => setHandling(e.target.value)} />}
            </Field>
            <Field label="TCS, ₹">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={tcs} onChange={(e) => setTcs(e.target.value)} />}
            </Field>
            <Field label="Total, as printed, ₹">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={printed} onChange={(e) => setPrinted(e.target.value)} />}
            </Field>
          </div>
          <p className="text-sm tabular text-right" data-bill-check>
            <span className="text-grey-600">The lines, handling and TCS make </span>
            <span className="font-medium text-ink-900">{money(made)}</span>
            {off === null ? null : Math.abs(off) <= 1
              ? <span className="text-success"> · matches the bill</span>
              : <span className="text-brand-red-700 font-medium"> · {money(Math.abs(off))} {off > 0 ? "more" : "less"} than the bill</span>}
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <Checkbox checked={onCredit}
              onCheckedChange={(v) => { setOnCredit(v); if (v && !dueOn) setDueOn(suggestedDue(billDate)); }}
              label="On credit - the bill is paid later" />
            {onCredit && (
              <Field label="Due on">
                {(p) => <Input {...fieldProps(p)} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
              </Field>
            )}
          </div>

          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
