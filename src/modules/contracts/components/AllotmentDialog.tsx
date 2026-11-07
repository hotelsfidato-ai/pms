import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Textarea, toast,
} from "@/components/ui";
import { dateShort } from "@/lib/format";
import {
  addAllotment, saveAllotment, stopAllotment,
  type Allotment, type CompanyContracts, type Contract,
} from "@/modules/contracts/data/contracts";

/* ══════════════════════════════════════════════════════════════════
   HOLD ROOMS, OR CHANGE AN ALLOTMENT (D27-383 item 8, migration 271)

   Rooms of one type for a run of nights inside the contract, released N
   days before each night at the night audit. The server refuses a hold the
   hotel has no free rooms for, night by night, by name. Kept by the owner,
   an administrator and the GM, as the contract is (C-6).
   ══════════════════════════════════════════════════════════════════ */

interface Form { roomTypeId: string; firstNight: string; lastNight: string; rooms: string; releaseDays: string; notes: string }

const formFor = (a: Allotment | undefined, k: Contract, data: CompanyContracts): Form => ({
  roomTypeId: a?.roomTypeId ?? data.roomTypes[0]?.id ?? "",
  firstNight: a?.firstNight ?? (data.today > k.validFrom ? data.today : k.validFrom),
  lastNight: a?.lastNight ?? "",
  rooms: a ? String(a.rooms) : "",
  releaseDays: a ? String(a.releaseDays) : "",
  notes: a?.notes ?? "",
});

export function AllotmentDialog({ hotelId, data, contract, allotment, open, onOpenChange }: {
  hotelId: string;
  data: CompanyContracts;
  contract: Contract;
  /** Absent: a new allotment under `contract`. */
  allotment?: Allotment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => formFor(allotment, contract, data));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (open) { setForm(formFor(allotment, contract, data)); setStopping(false); }
  }, [open, allotment, contract, data]);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const rooms = Number(form.rooms);
  const release = Number(form.releaseDays);

  const wrong = (!form.firstNight || !form.lastNight ? "Choose the first and the last night." : null)
    ?? (form.lastNight < form.firstNight ? "The last night is on or after the first." : null)
    ?? (form.firstNight < contract.validFrom || form.lastNight > contract.validTo
      ? "An allotment's nights are inside its contract." : null)
    ?? (!(Number.isInteger(rooms) && rooms >= 1 && rooms <= 500) ? "Rooms is a whole number from 1 to 500." : null)
    ?? (form.releaseDays.trim() === "" || !(Number.isInteger(release) && release >= 0 && release <= 365)
      ? "Release days is a whole number from 0 to 365." : null);

  const done = (title: string, said: string) => {
    onOpenChange(false);
    toast.success(title, said);
    void queryClient.invalidateQueries();
  };

  const save = async () => {
    const input = {
      firstNight: form.firstNight, lastNight: form.lastNight, rooms, releaseDays: release,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    const result = allotment
      ? await saveAllotment(hotelId, allotment.id, input)
      : await addAllotment(hotelId, { ...input, contractId: contract.id, roomTypeId: form.roomTypeId });
    setBusy(false);
    if (!result.ok) return toast.error(allotment ? "Not changed" : "Not held", result.reason);
    done(allotment ? "Allotment changed" : "Rooms held",
      "Availability and the Calendar show them as held. Bookings from it are made from its Book button.");
  };

  const stop = async () => {
    if (!allotment) return;
    setBusy(true);
    const result = await stopAllotment(hotelId, allotment.id);
    setBusy(false);
    if (!result.ok) return toast.error("Not stopped", result.reason);
    done("No longer held", "What it held is back on sale. Bookings made from it stand.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={allotment ? "Change allotment" : "Hold rooms"}
        description={`${data.company.name}, under "${contract.name}" (${dateShort(contract.validFrom)} to ${dateShort(contract.validTo)}). `
          + "Booked at the contract's rate."}
        footer={
          <div className="flex flex-wrap gap-2 w-full justify-end">
            {allotment && (
              <Button variant="secondary" size="lg" className="sm:mr-auto" disabled={busy}
                onClick={() => (stopping ? void stop() : setStopping(true))}>
                {stopping ? "Yes, stop holding" : "Stop holding"}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={wrong !== null}
              onClick={() => void save()}>
              {allotment ? "Save" : "Hold rooms"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Room type" hint={allotment ? "An allotment keeps its room type: stop it and hold another to change it." : undefined}>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={form.roomTypeId} disabled={!!allotment}
                onChange={(e) => set("roomTypeId")(e.target.value)}>
                {data.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First night">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.firstNight}
                min={contract.validFrom} max={contract.validTo}
                onChange={(e) => set("firstNight")(e.target.value)} />}
            </Field>
            <Field label="Last night">
              {(f) => <Input {...fieldProps(f)} type="date" value={form.lastNight}
                min={form.firstNight || contract.validFrom} max={contract.validTo}
                onChange={(e) => set("lastNight")(e.target.value)} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rooms a night">
              {(f) => <Input {...fieldProps(f)} type="number" inputMode="numeric" className="tabular"
                value={form.rooms} onChange={(e) => set("rooms")(e.target.value)} />}
            </Field>
            <Field label="Release (days before each night)"
              hint="Rooms nobody booked go back on sale at that night audit.">
              {(f) => <Input {...fieldProps(f)} type="number" inputMode="numeric" className="tabular"
                value={form.releaseDays} onChange={(e) => set("releaseDays")(e.target.value)} />}
            </Field>
          </div>
          <Field label="Notes">
            {(f) => <Textarea {...fieldProps(f)} rows={2} maxLength={500} value={form.notes}
              onChange={(e) => set("notes")(e.target.value)} />}
          </Field>
          {stopping && (
            <p className="text-sm text-brand-red-700">
              What it still holds goes back on sale now. Bookings made from it stand. Press again to stop holding.
            </p>
          )}
          {wrong && (form.lastNight || form.rooms) && <p className="text-sm text-brand-red-700" data-allotment-wrong>{wrong}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
