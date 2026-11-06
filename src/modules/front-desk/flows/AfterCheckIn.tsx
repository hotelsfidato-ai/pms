import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Textarea, toast,
} from "@/components/ui";
import type { DeskRules } from "@/lib/api";
import { can, type Role } from "@/lib/permissions";
import { dateShort } from "@/lib/format";
import { askTheGm, undoCheckIn, type AskKind } from "@/modules/front-desk/data/operations";
import { ReadyReasons } from "@/modules/front-desk/components/ReadyReasons";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   AFTER CHECK-IN (the owner's D27-397, 6 November)

   Who may unmake an arrival - undo the check-in, cancel or void a guest in
   house - by Front desk rules' "The GM may undo a check-in" (on at every
   hotel): the owner and an Admin always; the GM while it is on; anybody
   else who may change a booking asks the GM; off, the old lock. The server
   asks the same (front-desk/afterCheckIn.ts) - this is what a clerk sees.
   ══════════════════════════════════════════════════════════════════ */

export type UndoRight = "yes" | "ask" | "no";

export function undoRightFor(role: Role, rules: DeskRules | undefined): UndoRight {
  if (role === "owner" || role === "admin") return "yes";
  /* An older server sends no switch: it is on (266 starts it on). */
  if (rules?.gmMayUndoCheckIn === false) return "no";
  if (role === "gm") return "yes";
  return can(role, "edit", "reservation") ? "ask" : "no";
}

/** The switch off, said where the item is greyed. */
export const UNDO_OFF =
  "Undoing a check-in is off at this hotel (Settings, Front desk rules). Check them out instead.";

/* ── Undo check-in ────────────────────────────────────────────────── */

export function UndoCheckInFlow({ hotelId, stay, open, onOpenChange }: {
  hotelId: string; stay: Stay; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const submit = async () => {
    setBusy(true);
    const res = await undoCheckIn(hotelId, stay.id, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Check-in not undone", res.reason);
    onOpenChange(false);
    setReason("");
    toast.success("Check-in undone",
      `${stay.reference} is arriving again.${stay.roomNumber ? ` Room ${stay.roomNumber} is to be cleaned.` : ""}`);
    void qc.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Undo the check-in"
        description={`${stay.guest} · back to confirmed, arriving ${dateShort(stay.arrival)}.`}
        size="sm"
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Keep it</Button>
            <Button variant="danger" size="lg" loading={busy} disabled={!reason.trim()}
              onClick={() => void submit()}>
              Undo check-in
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-700 leading-relaxed">
            The room stays theirs and is sent for cleaning, and a key card cut stops.
            The first night's room charge comes off; payments stay on the bill as an advance.
            Any other charge has to be reversed on the bill first.
          </p>
          <Field label="Why" required hint="Kept on the booking, with your name and the time.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={2} value={reason} autoFocus
                onChange={(e) => setReason(e.target.value)} placeholder="Checked in the wrong booking" />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Ask the GM ───────────────────────────────────────────────────── */

const ASKED: Record<AskKind, { title: string; field?: "date" | "rate" | "method" }> = {
  undo_check_in: { title: "Ask the GM to undo the check-in" },
  cancel: { title: "Ask the GM to cancel this booking" },
  void: { title: "Ask the GM to void this booking" },
  arrival: { title: "Ask the GM to change the arrival date", field: "date" },
  rate: { title: "Ask the GM to change the rate", field: "rate" },
  payment_method: { title: "Ask the GM to change how it was paid", field: "method" },
};

/** Sent with a reason to the GM's Approvals and bell; the GM's approval does
    it, with every check (the restaurant's way, D27-363). `methods`: the
    hotel's ways of paying, for a payment's. */
export function AskGmDialog({ hotelId, stay, kind, open, onOpenChange, postingId, methods = [] }: {
  hotelId: string; stay: Stay; kind: AskKind; open: boolean; onOpenChange: (o: boolean) => void;
  postingId?: string; methods?: string[];
}) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const { title, field } = ASKED[kind];

  const submit = async () => {
    setBusy(true);
    const res = await askTheGm(hotelId, stay.id, {
      kind, reason: reason.trim(),
      ...(field === "date" ? { checkIn: value } : {}),
      ...(field === "rate" ? { rate: Number(value) } : {}),
      ...(field === "method" ? { postingId: postingId ?? "", method: value } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not sent", res.reason);
    onOpenChange(false);
    setReason(""); setValue("");
    toast.success("Sent to the GM", "It waits in their Approvals. Approved, it is done.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={`${stay.guest} · ${stay.reference}. Nothing changes until the GM approves it.`}
        size="sm"
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy}
              disabled={!reason.trim() || (field !== undefined && !value.trim())}
              onClick={() => void submit()}>
              Send to the GM
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {field === "date" && (
            <Field label="Arrival" required hint="No later than today, and never a day the Night audit has closed.">
              {(f) => (
                <Input {...fieldProps(f)} type="date" value={value || stay.arrival}
                  onChange={(e) => setValue(e.target.value)} className="h-12 text-base" />
              )}
            </Field>
          )}
          {field === "rate" && (
            <Field label="New rate a night" required hint="Before tax. Nights already charged are corrected to it.">
              {(f) => (
                <Input {...fieldProps(f)} numeric inputMode="decimal" value={value}
                  onChange={(e) => setValue(e.target.value)} />
              )}
            </Field>
          )}
          {field === "method" && (
            <Field label="How it was really paid" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Choose</option>
                  {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                </NativeSelect>
              )}
            </Field>
          )}
          <Field label="Why" required hint="The GM reads it before approving.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={2} value={reason}
                onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          {(kind === "cancel" || kind === "void") && (
            <ReadyReasons kind={kind === "cancel" ? "reason_cancel" : "reason_void"} onPick={setReason} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
