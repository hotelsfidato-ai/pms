import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import {
  getGuestContact, saveGuestContact, saveStayCompany, type GuestContact,
} from "@/modules/guests/data/directory";
import {
  countryProblem, emailProblem, gstinProblem, phoneProblem,
} from "../../../../api/src/validate.ts";

/** The guest's company on the stay the dialog was opened from (D27-371). */
type Company = { name: string; gstin: string; address: string };
const COMPANY_KEYS = ["name", "gstin", "address"] as const;

/* ══════════════════════════════════════════════════════════════════
   EDIT GUEST (GU-1; the owner, 28 September)

   No screen could correct a guest's name, phone, email, address or
   nationality. One dialog, opened from the stay panel and Guest 360, for
   the roles holding customer:edit. Only what changed is sent; the server
   refuses an impossible phone, email or country in the same words, and
   every change is kept in the audit log (the guests trigger).
   ══════════════════════════════════════════════════════════════════ */

type Form = Omit<GuestContact, "id">;
const FIELDS: (keyof Form)[] = ["title", "fullName", "phone", "email", "nationality",
  "addressLine", "city", "state", "pincode", "country"];
const TITLES = ["Mr", "Ms", "Mrs", "Dr"];

export function EditGuestFlow({ hotelId, guestId, open, onOpenChange, stay }: {
  hotelId: string; guestId: string; open: boolean; onOpenChange: (open: boolean) => void;
  /** From the stay panel, for whoever may change a booking: that stay's
      company, edited with the guest (D27-371). Kept on the booking, not the
      guest. Absent (Guest 360), the section is not shown. */
  stay?: { id: string; company: { name: string | null; gstin: string | null; address: string | null } | null };
}) {
  const was: Company = {
    name: stay?.company?.name ?? "", gstin: stay?.company?.gstin ?? "", address: stay?.company?.address ?? "",
  };
  const [company, setCompany] = useState<Company>(was);
  const companyChanged = !!stay && COMPANY_KEYS.some((k) => was[k] !== company[k].trim());
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: ["guest-contact", hotelId, guestId],
    queryFn: () => getGuestContact(hotelId, guestId),
    enabled: open,
  });
  const [form, setForm] = useState<Record<keyof Form, string>>(() => blank());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (record.data) {
      setForm(Object.fromEntries(FIELDS.map((k) => [k, record.data[k] ?? ""])) as Record<keyof Form, string>);
    }
  }, [record.data]);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const wrong = (!form.fullName.trim() ? "A guest has a name." : null)
    ?? phoneProblem(form.phone) ?? emailProblem(form.email)
    ?? countryProblem(form.nationality) ?? (!form.nationality.trim() ? "Nationality is a two-letter country code, e.g. IN." : null)
    ?? gstinProblem(company.gstin);
  const changes = record.data
    ? Object.fromEntries(FIELDS.filter((k) => (record.data[k] ?? "") !== form[k].trim())
        .map((k) => [k, form[k].trim()]))
    : {};

  const save = async () => {
    setBusy(true);
    const result = Object.keys(changes).length ? await saveGuestContact(hotelId, guestId, changes) : null;
    const companyResult = companyChanged && stay
      ? await saveStayCompany(hotelId, stay.id, {
          name: company.name.trim(), gstin: company.gstin.trim(), address: company.address.trim() })
      : null;
    setBusy(false);
    void queryClient.invalidateQueries();
    if (result && !result.ok) return toast.error("Not changed", result.reason);
    if (companyResult && !companyResult.ok) return toast.error("The company was not changed", companyResult.reason);
    onOpenChange(false);
    toast.success("Guest updated", result
      ? `${result.guest.fullName}: the change is on every booking of theirs.`
      : "The company is on this booking, for its tax invoice.");
  };

  const text = (k: keyof Form, label: string, type = "text") => (
    <Field label={label}>
      {(f) => <Input {...fieldProps(f)} type={type} value={form[k]} onChange={(e) => set(k)(e.target.value)} />}
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit guest"
        description="The guest's own record: it is the same on every booking of theirs, at every hotel."
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy}
              disabled={!record.data || wrong !== null || (Object.keys(changes).length === 0 && !companyChanged)}
              onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      >
        {record.isLoading ? <p className="text-sm text-grey-600">Loading…</p>
          : record.isError ? <p className="text-sm text-brand-red-700">The guest's record could not be read.</p>
          : (
            <div className="space-y-4">
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <Field label="Title">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={form.title} onChange={(e) => set("title")(e.target.value)}>
                      <option value="">None</option>
                      {TITLES.map((t) => <option key={t}>{t}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                {text("fullName", "Name")}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {text("phone", "Phone", "tel")}
                {text("email", "Email", "email")}
              </div>
              {text("addressLine", "Address")}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {text("city", "City")}
                {text("state", "State")}
                {text("pincode", "PIN code")}
                {text("country", "Country")}
              </div>
              <Field label="Nationality" hint="Two letters: IN for India. Anything else puts the guest on the Form III register.">
                {(f) => (
                  <Input {...fieldProps(f)} value={form.nationality} maxLength={2} className="w-24"
                    onChange={(e) => set("nationality")(e.target.value.toUpperCase())} />
                )}
              </Field>
              {stay && (
                /* D27-371: this booking's, not the guest's record. */
                <div className="space-y-3 border-t border-grey-200 pt-4" data-stay-company>
                  <p className="text-sm text-grey-600">
                    This booking's company. With a GSTIN, its tax invoice is made out to the company; the guest still pays.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Company name">
                      {(f) => <Input {...fieldProps(f)} value={company.name} maxLength={200}
                        onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))} />}
                    </Field>
                    <Field label="GSTIN">
                      {(f) => <Input {...fieldProps(f)} value={company.gstin} maxLength={15} className="tabular uppercase"
                        onChange={(e) => setCompany((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))} />}
                    </Field>
                  </div>
                  <Field label="Company address">
                    {(f) => <Input {...fieldProps(f)} value={company.address} maxLength={500}
                      onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))} />}
                  </Field>
                </div>
              )}
              {wrong && <p className="text-sm text-brand-red-700" data-edit-guest-wrong>{wrong}</p>}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

const blank = () => Object.fromEntries(FIELDS.map((k) => [k, ""])) as Record<keyof Form, string>;
