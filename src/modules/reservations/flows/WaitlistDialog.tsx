import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Textarea, toast,
} from "@/components/ui";
import { addToWaitlist, type WaitlistInput } from "@/modules/reservations/data/waitlist";

/* ══════════════════════════════════════════════════════════════════
   PUT A GUEST ON THE WAITLIST (D27-383 item 8, migration 272)

   Name, phone, the nights, the room type and a note. Opened from the
   Waitlist screen, or from New booking where a room type is full, with
   what was typed there. Nothing is booked or sent by the system.
   ══════════════════════════════════════════════════════════════════ */

export function WaitlistDialog({ hotelId, types, start, open, onOpenChange }: {
  hotelId: string;
  types: { id: string; name: string }[];
  /** What New booking already holds, so nothing is typed twice. */
  start: Partial<WaitlistInput>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const fresh = (): WaitlistInput => ({
    guestName: "", phone: "", roomTypeId: types[0]?.id ?? "", arrival: "", departure: "", note: "", ...start,
  });
  const [form, setForm] = useState<WaitlistInput>(fresh);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm(fresh()); }, [open]);

  const set = (k: keyof WaitlistInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const wrong = (!form.guestName.trim() ? "Whose name goes on the waitlist?" : null)
    ?? (!form.arrival || !form.departure ? "Choose the arrival and the departure." : null)
    ?? (form.departure <= form.arrival ? "The departure is after the arrival." : null)
    ?? (!form.roomTypeId ? "Which room type are they waiting for?" : null);

  const save = async () => {
    setBusy(true);
    const result = await addToWaitlist(hotelId, {
      ...form, guestName: form.guestName.trim(), phone: form.phone.trim(), note: form.note.trim(),
    });
    setBusy(false);
    if (!result.ok) return toast.error("Not added", result.reason);
    onOpenChange(false);
    toast.success(`${form.guestName.trim()} is on the waitlist`,
      "When a room frees up for those nights, the Waitlist shows it. Nobody is told by the system.");
    void qc.invalidateQueries({ queryKey: ["waitlist", hotelId] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Put on the waitlist"
        description="For nights and a room type that are full. When a room frees up, the Waitlist shows it; the desk decides."
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={wrong !== null} onClick={() => void save()}>
              Add to the waitlist
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Guest's name">
              {(f) => <Input {...fieldProps(f)} value={form.guestName} maxLength={120}
                onChange={(e) => set("guestName")(e.target.value)} />}
            </Field>
            <Field label="Phone">
              {(f) => <Input {...fieldProps(f)} value={form.phone} inputMode="tel"
                onChange={(e) => set("phone")(e.target.value)} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Arrival">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.arrival}
                onChange={(e) => set("arrival")(e.target.value)} />}
            </Field>
            <Field label="Departure">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.departure} min={form.arrival}
                onChange={(e) => set("departure")(e.target.value)} />}
            </Field>
          </div>
          <Field label="Room type">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={form.roomTypeId}
                onChange={(e) => set("roomTypeId")(e.target.value)}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Note">
            {(f) => <Textarea {...fieldProps(f)} rows={2} maxLength={500} value={form.note}
              placeholder="Would take another type; call after 6 pm"
              onChange={(e) => set("note")(e.target.value)} />}
          </Field>
          {wrong && form.guestName.trim() && <p className="text-sm text-brand-red-700">{wrong}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
