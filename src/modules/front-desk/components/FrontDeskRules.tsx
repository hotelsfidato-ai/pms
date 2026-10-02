import { useState } from "react";
import { cn } from "@/lib/cn";
import { getSession, type DeskRules } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Card, Button, Dialog, DialogContent, DialogClose, Field, fieldProps, Input, NativeSelect,
  Switch, toast,
} from "@/components/ui";
import { saveDeskRules } from "@/modules/front-desk/data/operations";

/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK'S RULES, PER HOTEL (the owner's D27-243, D27-246; 189)

   Each was fixed in code, the same at every hotel; each starts on what the
   code did. Shown on Settings › Operations; saved by the front desk's
   PATCH /:code/front-desk and read by every screen from the hotel list,
   which is fetched again after a save so the screens use it at once.
   ══════════════════════════════════════════════════════════════════ */

const PAYING = ["Cash", "UPI", "Credit Card", "Debit Card"] as const;
const ADVANCE = [
  ["none", "None"], ["first_night", "The first night"], ["whole_stay", "The whole stay"],
] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IDS = [
  ["", "None"], ["aadhaar", "Aadhaar"], ["passport", "Passport"],
  ["driving_licence", "Driving licence"], ["voter", "Voter ID"], ["other", "Other"],
] as const;
const TITLES = ["", "Mr", "Ms", "Mrs", "Dr"];

const START: DeskRules = {
  defaultPaymentMethod: "Cash", deskMayOverbook: true, advanceBeforeCheckIn: "none",
  weekendDays: [0, 6], defaultIdType: null, defaultNationality: "IN", defaultTitle: null,
};

export function FrontDeskRulesCard({ hotelId }: { hotelId: string }) {
  const hotel = useSession((s) => s.hotels.find((h) => h.code === hotelId || h.id === hotelId));
  const [editing, setEditing] = useState(false);
  const rules = hotel?.deskRules ?? START;

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5" data-desk-rules>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 flex-1 min-w-0">
        <Figure label="Way of paying" value={rules.defaultPaymentMethod} />
        <Figure label="Desk may overbook" value={rules.deskMayOverbook ? "Yes" : "No"} />
        <Figure label="Advance before check-in"
          value={ADVANCE.find(([v]) => v === rules.advanceBeforeCheckIn)?.[1] ?? "None"} />
        <Figure label="Weekend" value={rules.weekendDays.map((d) => DAYS[d]).join(", ") || "-"} />
        <Figure label="ID starts on"
          value={IDS.find(([v]) => v === (rules.defaultIdType ?? ""))?.[1] ?? "None"} />
        <Figure label="Nationality" value={rules.defaultNationality} />
        <Figure label="Title" value={rules.defaultTitle ?? "-"} />
      </dl>
      <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
      {editing && (
        <RulesDialog hotelId={hotelId} current={rules} onClose={() => setEditing(false)} />
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      {/* Wraps: "Advance before check-in" ran into its neighbour at 375 px. */}
      <dt className="text-sm text-grey-500">{label}</dt>
      <dd className={cn("text-md font-semibold", value === "-" ? "text-grey-500" : "text-ink-900")}>{value}</dd>
    </div>
  );
}

function RulesDialog({ hotelId, current, onClose }: {
  hotelId: string; current: DeskRules; onClose: () => void;
}) {
  const [r, setR] = useState(current);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DeskRules>) => setR((was) => ({ ...was, ...patch }));

  const submit = async () => {
    setBusy(true);
    const res = await saveDeskRules(hotelId, r);
    if (res.ok) {
      /* The screens read the hotel list: fetch it again so they use it now. */
      const { hotels } = await getSession().catch(() => ({ hotels: null }));
      if (hotels) useSession.setState({ hotels });
    }
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Front desk rules"
        description="What the desk's screens start on, and what they allow."
        footer={
          <>
            <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Way of paying" hint="The bill, a function's bill and New booking's advance. The till keeps Cash.">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={r.defaultPaymentMethod}
                  onChange={(e) => set({ defaultPaymentMethod: e.target.value as DeskRules["defaultPaymentMethod"] })}>
                  {PAYING.map((m) => <option key={m} value={m}>{m}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Advance before check-in" hint="Never asked of a company's booking, a room the group's host pays for, or a booking prepaid on a booking site.">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={r.advanceBeforeCheckIn}
                  onChange={(e) => set({ advanceBeforeCheckIn: e.target.value as DeskRules["advanceBeforeCheckIn"] })}>
                  {ADVANCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Switch checked={r.deskMayOverbook} onCheckedChange={(v) => set({ deskMayOverbook: v })}
            label="The desk may overbook"
            description="Off: a booking - or a group - past a full house is refused." />
          <fieldset>
            <legend className="text-sm font-medium text-ink-900">Weekend</legend>
            <p className="text-sm text-grey-500">Shaded on the Calendar and Rates. No price reads it.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = r.weekendDays.includes(i);
                return (
                  <button key={d} type="button" aria-pressed={on}
                    onClick={() => set({ weekendDays: on ? r.weekendDays.filter((x) => x !== i) : [...r.weekendDays, i].sort() })}
                    className={cn("h-9 px-3 rounded-lg border text-sm transition-colors duration-150",
                      on ? "border-brand-orange bg-brand-orange-50 text-ink-900" : "border-grey-200 bg-white text-grey-600")}>
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ID starts on" hint="For a guest of the hotel's nationality.">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={r.defaultIdType ?? ""}
                  onChange={(e) => set({ defaultIdType: e.target.value || null })}>
                  {IDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Nationality" hint="Two letters, IN for India.">
              {(f) => (
                <Input {...fieldProps(f)} value={r.defaultNationality} maxLength={2}
                  onChange={(e) => set({ defaultNationality: e.target.value.toUpperCase() })} />
              )}
            </Field>
            <Field label="Title">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={r.defaultTitle ?? ""}
                  onChange={(e) => set({ defaultTitle: e.target.value || null })}>
                  {TITLES.map((t) => <option key={t} value={t}>{t || "None"}</option>)}
                </NativeSelect>
              )}
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
