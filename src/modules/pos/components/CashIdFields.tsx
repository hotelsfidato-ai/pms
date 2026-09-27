import { Input } from "@/components/ui";
import type { CashId } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   MORE THAN ₹1,00,000 IN CASH ON ONE BILL (the owner's D25-40)

   Income-tax Rule 159: the guest's PAN, or Form 97 from a guest who has
   none; a guest from abroad is not asked. Shown on a bill above ₹1,00,000;
   the server asks only when that much of it is cash, and refuses cash of
   ₹2,00,000 or more on one bill whatever is typed here.
   ══════════════════════════════════════════════════════════════════ */
export function CashIdFields({ value, onChange }: {
  value: CashId;
  onChange: (next: CashId) => void;
}) {
  const tick = (key: "form97" | "nonResident", label: string) => (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <input type="checkbox" checked={value[key] === true}
        onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
        className="size-4 rounded-xs accent-brand-orange" />
      <span className="text-base text-ink-900">{label}</span>
    </label>
  );
  return (
    /* A washed panel, not a bordered box: it sits inside the order's card
       (never a card inside a card). */
    <div className="rounded-lg bg-grey-50 px-3.5 py-3 space-y-2">
      <p className="text-sm text-grey-600">
        More than ₹1,00,000 in cash needs the guest's PAN, Form 97, or a guest from abroad.
      </p>
      <Input aria-label="Guest's PAN" placeholder="PAN, like ABCDE1234F" maxLength={10}
        autoComplete="off" value={value.pan ?? ""}
        onChange={(e) => onChange({ ...value, pan: e.target.value.toUpperCase() })} />
      {tick("form97", "No PAN: Form 97 taken")}
      {tick("nonResident", "Guest from abroad")}
    </div>
  );
}
