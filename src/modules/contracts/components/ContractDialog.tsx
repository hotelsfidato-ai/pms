import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, Segmented, Textarea, toast,
} from "@/components/ui";
import {
  addContract, saveContract,
  type CompanyContracts, type Contract, type ContractInput,
} from "@/modules/contracts/data/contracts";

/* ══════════════════════════════════════════════════════════════════
   ADD OR EDIT A CONTRACT (D27-184)

   C-1: fixed rates OR a discount off the day's rate. C-2: fixed rates are
   single and double per room type and meal plan; a blank is "not agreed",
   and a booking then takes the day's price (C-4). C-8: an agent's
   commission. The owner, an administrator and the GM only (C-6).
   ══════════════════════════════════════════════════════════════════ */

type Cells = Record<string, { single: string; double: string }>;
const cellKey = (roomTypeId: string, mealPlan: string) => `${roomTypeId}|${mealPlan}`;
const shown = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

interface Form {
  name: string; validFrom: string; validTo: string; pricing: "rates" | "discount";
  discountPercent: string; commissionPct: string; notes: string; cells: Cells;
}

const fromContract = (k: Contract | undefined, today: string): Form => ({
  name: k?.name ?? "", validFrom: k?.validFrom ?? today, validTo: k?.validTo ?? "",
  pricing: k?.pricing ?? "rates", discountPercent: shown(k?.discountPercent),
  commissionPct: shown(k?.commissionPct), notes: k?.notes ?? "",
  cells: Object.fromEntries((k?.rates ?? []).map((r) =>
    [cellKey(r.roomTypeId, r.mealPlan), { single: shown(r.single), double: shown(r.double) }])),
});

export function ContractDialog({ hotelId, data, contract, open, onOpenChange }: {
  hotelId: string;
  data: CompanyContracts;
  /** Absent: a new contract. */
  contract?: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => fromContract(contract, data.today));
  const [busy, setBusy] = useState(false);
  const agent = data.company.kind === "travel_agent";

  useEffect(() => { if (open) setForm(fromContract(contract, data.today)); }, [open, contract, data.today]);

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setCell = (key: string, which: "single" | "double", v: string) =>
    setForm((f) => ({ ...f, cells: { ...f.cells, [key]: { single: "", double: "", ...f.cells[key], [which]: v } } }));

  const rates = Object.entries(form.cells)
    .map(([key, c]) => {
      const [roomTypeId, mealPlan] = key.split("|") as [string, string];
      return { roomTypeId, mealPlan, single: numberOrNull(c.single), double: numberOrNull(c.double) };
    })
    .filter((r) => r.single !== null || r.double !== null);
  const pct = numberOrNull(form.discountPercent);
  const commission = numberOrNull(form.commissionPct);

  const wrong = (!form.name.trim() ? "Give the contract a name, e.g. the company and the year." : null)
    ?? (!form.validFrom || !form.validTo ? "Valid from and to: choose both dates." : null)
    ?? (form.validTo < form.validFrom ? "A contract ends on or after the day it starts." : null)
    ?? (form.pricing === "discount" && !(pct !== null && pct > 0 && pct <= 100)
      ? "The discount is a percentage above 0, at most 100." : null)
    ?? (form.pricing === "rates" && rates.some((r) => [r.single, r.double].some((p) => p !== null && !(p > 0)))
      ? "A contract rate is an amount above 0. Leave it blank where none is agreed." : null)
    ?? (form.pricing === "rates" && rates.length === 0
      ? "Type at least one rate, or choose a discount off the day's rate." : null)
    ?? (commission !== null && !(commission >= 0 && commission <= 100)
      ? "Commission is a percentage from 0 to 100." : null);

  const save = async () => {
    const input: ContractInput = {
      name: form.name.trim(), validFrom: form.validFrom, validTo: form.validTo, pricing: form.pricing,
      discountPercent: form.pricing === "discount" ? pct : null,
      commissionPct: agent ? commission : null,
      notes: form.notes.trim() || null,
      rates: form.pricing === "rates" ? rates : [],
    };
    setBusy(true);
    const result = contract
      ? await saveContract(hotelId, contract.id, input)
      : await addContract(hotelId, data.company.id, input);
    setBusy(false);
    if (!result.ok) return toast.error(contract ? "Not changed" : "Not added", result.reason);
    onOpenChange(false);
    toast.success(contract ? "Contract updated" : "Contract added",
      "The next booking for this company is priced by it. Bookings already made keep their rate.");
    void queryClient.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg"
        title={contract ? "Edit contract" : "Add contract"}
        description={`${data.company.name}, at this hotel. The contract in force on the arrival date prices the booking.`}
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={wrong !== null}
              onClick={() => void save()}>
              {contract ? "Save" : "Add contract"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            {(f) => <Input {...fieldProps(f)} value={form.name} maxLength={80}
              placeholder={`${data.company.name} 2026-27`} onChange={(e) => set("name")(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.validFrom}
                onChange={(e) => set("validFrom")(e.target.value)} />}
            </Field>
            <Field label="Valid to">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.validTo}
                onChange={(e) => set("validTo")(e.target.value)} />}
            </Field>
          </div>
          <Field label="Priced by">
            {() => (
              <Segmented value={form.pricing} onChange={set("pricing")}
                options={[
                  { value: "rates", label: "Fixed rates" },
                  { value: "discount", label: "Discount off the day's rate" },
                ]} />
            )}
          </Field>

          {form.pricing === "discount" ? (
            <Field label="Discount (%)" hint="Taken off the rate calendar's price for the arrival date.">
              {(f) => <Input {...fieldProps(f)} type="number" inputMode="decimal" className="w-32 tabular"
                value={form.discountPercent} onChange={(e) => set("discountPercent")(e.target.value)} />}
            </Field>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                Per room per night, before tax. Single is one guest, double two; a third guest pays
                the rate calendar's extra-person price. Blank is not agreed: the booking takes the day's price.
              </p>
              {data.roomTypes.map((t) => (
                <div key={t.id}>
                  <h3 className="text-sm font-semibold text-ink-900 mb-2">{t.name}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] gap-x-3 gap-y-2 items-center">
                    <span className="hidden sm:block text-xs text-grey-500">Meal plan</span>
                    <span className="text-xs text-grey-500">Single (₹)</span>
                    <span className="text-xs text-grey-500">Double (₹)</span>
                    {data.mealPlans.map((p) => {
                      const key = cellKey(t.id, p.code);
                      const cell = form.cells[key] ?? { single: "", double: "" };
                      return [
                        <span key={`${key}-l`} className="col-span-2 sm:col-span-1 text-sm text-grey-700">{p.code} · {p.includes}</span>,
                        <Input key={`${key}-s`} type="number" inputMode="decimal" placeholder="-"
                          aria-label={`${t.name} ${p.code} single`} className="tabular"
                          value={cell.single} onChange={(e) => setCell(key, "single", e.target.value)} />,
                        <Input key={`${key}-d`} type="number" inputMode="decimal" placeholder="-"
                          aria-label={`${t.name} ${p.code} double`} className="tabular"
                          value={cell.double} onChange={(e) => setCell(key, "double", e.target.value)} />,
                      ];
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {agent && (
            <Field label="Commission (%)" hint="Stamped on each booking made under this contract, in place of the booking source's. Blank is none agreed.">
              {(f) => <Input {...fieldProps(f)} type="number" inputMode="decimal" className="w-32 tabular"
                value={form.commissionPct} onChange={(e) => set("commissionPct")(e.target.value)} />}
            </Field>
          )}
          <Field label="Notes">
            {(f) => <Textarea {...fieldProps(f)} rows={2} maxLength={500} value={form.notes}
              onChange={(e) => set("notes")(e.target.value)} />}
          </Field>
          {wrong && form.name.trim() && <p className="text-sm text-brand-red-700" data-contract-wrong>{wrong}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
