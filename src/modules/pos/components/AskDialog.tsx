import { useState, type ReactNode } from "react";
import { Button, Dialog, DialogClose, DialogContent, Field, fieldProps, Textarea } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   A QUESTION ON SCREEN, NOT IN THE BROWSER (QA POS-2, NA-4)

   Close unpaid and the dish note asked through `window.prompt()`, which
   the app's own window, kiosk shells and some tablets refuse - silently,
   so the button did nothing and the restaurant's day could not close.
   One box for the three things the till asks: a reason it must have, a
   note it may have, and a plain "are you sure?" (D27-117).
   ══════════════════════════════════════════════════════════════════ */

/** What a manager is told before taking off food the kitchen has (D27-119). */
export const SENT_STRIKE =
  "The kitchen already has this. Only the owner, an administrator, the GM, the " +
  "hotel manager or the kitchen manager can take it off, and the reason prints " +
  "on the kitchen docket and in the day's report.";

export interface Ask {
  title: string;
  body?: ReactNode;
  /** A typed answer - `required` for a reason, not for a note. Absent for
      a plain "are you sure?". */
  field?: { label: string; required: boolean; hint?: string };
  confirm: string;
  onConfirm: (text: string) => unknown;
}

export function AskDialog({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setText(""); onClose(); };
  const blocked = busy || (!!ask?.field?.required && !text.trim());

  const go = async () => {
    if (!ask || blocked) return;
    setBusy(true);
    try { await ask.onConfirm(text.trim()); } finally { setBusy(false); }
    close();
  };

  return (
    <Dialog open={ask !== null} onOpenChange={(o) => { if (!o) close(); }}>
      {ask && (
        <DialogContent title={ask.title} size="sm">
          <div className="space-y-4">
            {ask.body && <div className="text-base text-grey-700">{ask.body}</div>}
            {ask.field && (
              <Field label={ask.field.label} {...(ask.field.hint ? { hint: ask.field.hint } : {})}>
                {(f) => (
                  <Textarea {...fieldProps(f)} rows={2} autoFocus value={text}
                            onChange={(e) => setText(e.target.value)} />
                )}
              </Field>
            )}
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
              </DialogClose>
              <Button variant="primary" className="h-12 flex-1" loading={busy}
                      disabled={blocked} onClick={() => void go()}>
                {ask.confirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
