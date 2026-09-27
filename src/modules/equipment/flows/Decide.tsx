import { useState } from "react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Textarea, toast,
} from "@/components/ui";
import { decideApproval, type EquipmentApproval } from "@/modules/equipment/data/equipment";

/* ══════════════════════════════════════════════════════════════════
   DECIDING A WAITING REQUEST — in the one approvals inbox

   The buttons are offered only where the core's queue says `mayDecide`;
   anywhere else its `blockedBecause` is the sentence (Rule 6). The
   decision goes to the core endpoint, which refuses anybody who may not
   decide and the person who asked — so this screen and the server cannot
   disagree. Refusing needs a reason: the person who asked has to know
   what to do next.
   ══════════════════════════════════════════════════════════════════ */

export function DecideButtons({ code, approval, approveLabel, onDone, quiet = false }: {
  code: string;
  /** On a screen whose one main action is something else, Approve is not
      drawn as a second primary button. */
  quiet?: boolean;
  /** Undefined while the inbox is loading, or if it could not be read. */
  approval: EquipmentApproval | undefined;
  approveLabel: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");

  if (!approval) return null;
  if (!approval.mayDecide) {
    return approval.blockedBecause
      ? <p className="text-sm text-grey-600 mt-1.5">{approval.blockedBecause}</p>
      : null;
  }

  const decide = async (decision: "approved" | "rejected") => {
    if (busy) return;
    setBusy(true);
    const res = await decideApproval(code, approval.id, decision, decision === "rejected" ? note.trim() : undefined);
    setBusy(false);
    if (!res.ok) return toast.error(decision === "approved" ? "Not approved" : "Not refused", res.reason);
    toast.success(decision === "approved" ? "Approved" : "Refused");
    setRefusing(false);
    onDone();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button variant={quiet ? "secondary" : "primary"} disabled={busy} onClick={() => void decide("approved")}>
          {approveLabel}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setRefusing(true)}>
          Refuse
        </Button>
      </div>
      {refusing && (
        <Dialog open onOpenChange={(o) => { if (!o) setRefusing(false); }}>
          <DialogContent
            title="Refuse it"
            description="Say why. The person who asked has to know what to do next."
            footer={
              <>
                <Button variant="secondary" onClick={() => setRefusing(false)}>Cancel</Button>
                <Button variant="danger" disabled={busy || !note.trim()}
                        onClick={() => void decide("rejected")}>
                  {busy ? "Refusing…" : "Refuse"}
                </Button>
              </>
            }
          >
            <Field label="Why" required>
              {(f) => <Textarea {...fieldProps(f)} value={note} rows={3}
                                onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
