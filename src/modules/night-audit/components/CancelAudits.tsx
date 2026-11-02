import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dateLong, dateShort, dateTime, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import {
  Card, CardHeader, CardBody, Button, Checkbox, Field, fieldProps, Textarea, NativeSelect,
  Skeleton, toast,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { getAuditUndo, setUndoMode, undoAudits, tallyDays, type AuditUndo } from "@/modules/night-audit/data/nightAudit";

/* ══════════════════════════════════════════════════════════════════
   CANCEL A NIGHT AUDIT (the owner's D27-390, 2 November)

   For an audit run by mistake: the hotel goes back to the day chosen,
   every audit from it on is undone (its room charges reversed, its
   no-shows booked again), and what was made since moves back to that
   day. The owner and an administrator, here in the Admin section. What
   the card lists is the server's own dry run of the very function that
   does it, so the list and the cancel cannot differ.
   ══════════════════════════════════════════════════════════════════ */

export function CancelAudits({ code }: { code: string }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const dry = useQuery({
    queryKey: ["night-audit-undo", code, to ?? "latest"],
    queryFn: () => getAuditUndo(code, to),
  });

  const changeMode = async (mode: AuditUndo["mode"]) => {
    const r = await setUndoMode(code, mode);
    if (!r.ok) return toast.error("Not changed", r.reason);
    setTo(undefined);
    void qc.invalidateQueries({ queryKey: ["night-audit-undo", code] });
  };

  const cancel = async (backTo: string) => {
    setBusy(true);
    try {
      const r = await undoAudits(code, backTo, reason.trim());
      if (!r.ok) return toast.error("Nothing was cancelled", r.reason);
      toast.success(`${code} is on ${dateLong(r.businessDate)} again`,
        r.roomsNotHeld.length
          ? `Somebody else holds the room of ${r.roomsNotHeld.join(", ")}: give them another.`
          : "Run the night audit for it when the day is done.");
      setReason(""); setChecked(false); setTo(undefined);
      /* The business date has moved back: the session and every screen with it. */
      await useSession.getState().refresh();
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  const d = dry.data;
  return (
    <Card className="mb-3">
      <CardHeader
        title="Cancel a night audit"
        description="For an audit run by mistake. The hotel goes back to the day you choose: every audit from it on is undone, its room charges reversed and its no-shows booked again, and what was billed since moves back to that day. Kept with your reason, as a mistake."
      />
      <CardBody className="space-y-4">
        {dry.isLoading ? <Skeleton className="h-24" /> : dry.error || !d ? (
          <p className="text-sm text-brand-red-700">{describeError(dry.error).message}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How far back">
                {(p) => (
                  <NativeSelect {...fieldProps(p)} value={d.mode}
                    onChange={(e) => void changeMode(e.target.value as AuditUndo["mode"])}>
                    <option value="any_date">To any earlier day</option>
                    <option value="one_at_a_time">One audit at a time</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Back to">
                {(p) => (
                  <NativeSelect {...fieldProps(p)} value={d.backTo ?? ""}
                    disabled={d.mode === "one_at_a_time" || d.days.length === 0}
                    onChange={(e) => { setTo(e.target.value); setChecked(false); }}>
                    {d.days.length === 0 && <option value="">No audit has been run</option>}
                    {d.days.map((day) => <option key={day} value={day}>{dateLong(day)}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </div>

            {d.audits.length > 0 && (
              <div className="text-sm space-y-1">
                <p className="font-medium text-ink-900">
                  {d.audits.length === 1 ? "This audit is undone:" : `These ${d.audits.length} audits are undone:`}
                </p>
                <ul className="text-grey-700 space-y-0.5">
                  {d.audits.map((a) => (
                    <li key={a.businessDate}>
                      {dateLong(a.businessDate)} · closed {dateTime(a.completedAt)} by {a.ranBy ?? "-"}
                    </li>
                  ))}
                </ul>
                <p className="text-grey-700">
                  {d.chargesReversed} room {d.chargesReversed === 1 ? "charge" : "charges"} reversed
                  {d.chargesReversed ? ` (${money(d.chargesTotal)})` : ""}
                  {" · "}{d.noShowsRestored} {d.noShowsRestored === 1 ? "no-show" : "no-shows"} booked again
                </p>
                {d.moves.map((m) => (
                  <p key={m.table} className="text-grey-700">
                    {m.what}: {Object.entries(m.byDay)
                      .map(([day, n]) => `${n} on ${dateShort(day)}`).join(", ")} - moved to {dateShort(d.backTo!)}
                  </p>
                ))}
                {/* D27-390: the days these audits closed, and so could have been exported. */}
                <p className="text-brand-yellow-800">
                  {tallyDays(d.audits[0]!.businessDate, d.audits.at(-1)!.businessDate)}
                </p>
              </div>
            )}

            {d.refusal ? (
              <p className="text-sm text-brand-red-700">{d.refusal}</p>
            ) : (
              <>
                <Field label="Why" required>
                  {(p) => (
                    <Textarea {...fieldProps(p)} rows={2} maxLength={500}
                      value={reason} onChange={(e) => setReason(e.target.value)} />
                  )}
                </Field>
                <Checkbox checked={checked} onCheckedChange={setChecked}
                  label="I have read what this undoes and moves." />
                <Button variant="danger" disabled={!checked || !reason.trim() || busy || !d.backTo}
                  onClick={() => void cancel(d.backTo!)}>
                  {busy ? "Cancelling…" : `Cancel ${d.audits.length} ${d.audits.length === 1 ? "audit" : "audits"}`}
                </Button>
              </>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
