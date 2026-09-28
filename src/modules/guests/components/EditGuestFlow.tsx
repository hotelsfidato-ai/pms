import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import {
  getGuestContact, saveGuestContact, type GuestContact,
} from "@/modules/guests/data/directory";
import {
  countryProblem, emailProblem, phoneProblem,
} from "../../../../api/src/validate.ts";

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

export function EditGuestFlow({ hotelId, guestId, open, onOpenChange }: {
  hotelId: string; guestId: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
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
    ?? countryProblem(form.nationality) ?? (!form.nationality.trim() ? "Nationality is a two-letter country code, e.g. IN." : null);
  const changes = record.data
    ? Object.fromEntries(FIELDS.filter((k) => (record.data[k] ?? "") !== form[k].trim())
        .map((k) => [k, form[k].trim()]))
    : {};

  const save = async () => {
    setBusy(true);
    const result = await saveGuestContact(hotelId, guestId, changes);
    setBusy(false);
    if (!result.ok) return toast.error("Not changed", result.reason);
    onOpenChange(false);
    toast.success("Guest updated", `${result.guest.fullName}: the change is on every booking of theirs.`);
    void queryClient.invalidateQueries();
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
              disabled={!record.data || wrong !== null || Object.keys(changes).length === 0}
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
              {wrong && <p className="text-sm text-brand-red-700" data-edit-guest-wrong>{wrong}</p>}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

const blank = () => Object.fromEntries(FIELDS.map((k) => [k, ""])) as Record<keyof Form, string>;
