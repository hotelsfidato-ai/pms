import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, Segmented, Switch, toast,
} from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  addCompany, saveCompany, KIND_LABEL,
  type Company, type CompanyInput, type CompanyKind,
} from "@/modules/contracts/data/contracts";
import { emailProblem, gstinProblem, phoneProblem } from "../../../../api/src/validate.ts";

/* ══════════════════════════════════════════════════════════════════
   ADD OR EDIT A COMPANY (D27-184; QA GU-6)

   One dialog, from Contracts and from Companies and agents. The owner, an
   administrator and the GM see every field (C-6). Reception adds a company
   with its name, GSTIN and address only (C-7): its firm for the GST
   invoice, never credit. The server asks the same rules again.
   ══════════════════════════════════════════════════════════════════ */

type Text = "name" | "gstin" | "contactName" | "phone" | "email"
  | "addressLine" | "city" | "state" | "pincode" | "creditDays" | "creditLimit";
type Form = Record<Text, string> & { kind: CompanyKind; creditAllowed: boolean };

const fromCompany = (c?: Company): Form => ({
  name: c?.name ?? "", kind: c?.kind ?? "corporate", gstin: c?.gstin ?? "",
  contactName: c?.contactName ?? "", phone: c?.phone ?? "", email: c?.email ?? "",
  addressLine: c?.addressLine ?? "", city: c?.city ?? "", state: c?.state ?? "",
  pincode: c?.pincode ?? "", creditAllowed: c?.creditAllowed ?? false,
  creditDays: c?.creditDays === null || c?.creditDays === undefined ? "" : String(c.creditDays),
  creditLimit: c?.creditLimit === null || c?.creditLimit === undefined ? "" : String(c.creditLimit),
});

const orNull = (v: string) => v.trim() || null;
const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function CompanyDialog({ hotelId, company, open, onOpenChange, onSaved }: {
  hotelId: string;
  /** Absent: a new company. */
  company?: Company;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (id: string) => void;
}) {
  const role = useRole();
  const keeper = can(role, "edit", "company");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => fromCompany(company));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setForm(fromCompany(company)); }, [open, company]);

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const days = numberOrNull(form.creditDays);
  const limit = numberOrNull(form.creditLimit);
  const wrong = (!form.name.trim() ? "A company has a name." : null)
    ?? gstinProblem(form.gstin) ?? phoneProblem(form.phone) ?? emailProblem(form.email)
    ?? (form.pincode.trim() && !/^[1-9][0-9]{5}$/.test(form.pincode.trim())
      ? "A PIN code is 6 digits, e.g. 413216." : null)
    ?? (form.creditAllowed && days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)
      ? "Credit days is a whole number from 1 to 365." : null)
    ?? (form.creditAllowed && limit !== null && !(limit > 0)
      ? "A credit limit is an amount above 0, in rupees." : null);

  const save = async () => {
    const input: CompanyInput = {
      name: form.name.trim(), kind: form.kind, gstin: orNull(form.gstin)?.toUpperCase() ?? null,
      contactName: orNull(form.contactName), phone: orNull(form.phone), email: orNull(form.email),
      addressLine: orNull(form.addressLine), city: orNull(form.city), state: orNull(form.state),
      pincode: orNull(form.pincode), creditAllowed: form.creditAllowed,
      creditDays: form.creditAllowed ? days : null, creditLimit: form.creditAllowed ? limit : null,
    };
    setBusy(true);
    const result = company ? await saveCompany(hotelId, company.id, input) : await addCompany(hotelId, input);
    setBusy(false);
    if (!result.ok) return toast.error(company ? "Not changed" : "Not added", result.reason);
    onOpenChange(false);
    toast.success(company ? "Company updated" : "Company added", input.name);
    void queryClient.invalidateQueries();
    onSaved?.(result.id);
  };

  const text = (k: Text, label: string, type = "text", hint?: string) => (
    <Field label={label} hint={hint}>
      {(f) => <Input {...fieldProps(f)} type={type} value={form[k]} onChange={(e) => set(k)(e.target.value)} />}
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={company ? "Edit company" : "Add company"}
        description={keeper
          ? "One record for the group: the same company at every hotel."
          : "Its name, GSTIN and address, for the tax invoice. Credit and contracts are set by the owner, an administrator or the GM."}
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={wrong !== null}
              onClick={() => void save()}>
              {company ? "Save" : "Add company"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {text("name", "Name")}
          {keeper && (
            <Field label="Kind">
              {() => (
                <Segmented value={form.kind} onChange={set("kind")}
                  options={(Object.keys(KIND_LABEL) as CompanyKind[])
                    .map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              )}
            </Field>
          )}
          <Field label="GSTIN" hint="From the company's GST certificate. It prints on the company's tax invoices.">
            {(f) => (
              <Input {...fieldProps(f)} value={form.gstin} maxLength={15} className="tabular uppercase"
                onChange={(e) => set("gstin")(e.target.value.toUpperCase())} />
            )}
          </Field>
          {text("addressLine", "Billing address")}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {text("city", "City")}
            {text("state", "State")}
            {text("pincode", "PIN code")}
          </div>
          {keeper && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {text("contactName", "Contact person")}
                {text("phone", "Phone", "tel")}
                {text("email", "Email", "email")}
              </div>
              <Switch checked={form.creditAllowed} onCheckedChange={set("creditAllowed")}
                label="Credit allowed"
                description="A bill may be sent to the company to pay later (Bill to company)." />
              {form.creditAllowed && (
                <div className="grid grid-cols-2 gap-3">
                  {text("creditDays", "Credit days", "number")}
                  {text("creditLimit", "Credit limit (₹)", "number")}
                  <p className="col-span-2 text-xs text-grey-500">
                    Shown, not enforced, until the company's payments are recorded. Blank is not set.
                  </p>
                </div>
              )}
            </>
          )}
          {/* Not "has a name" on an empty new form: the button says it. */}
          {wrong && (form.name.trim() || company) && (
            <p className="text-sm text-brand-red-700" data-company-wrong>{wrong}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
