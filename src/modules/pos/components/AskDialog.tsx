import { useState, type ReactNode } from "react";
import { Button, Dialog, DialogClose, DialogContent, Field, fieldProps, Textarea } from "@/components/ui";
import type { TillResult } from "@/modules/pos/data/till";

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

/** What an answer may say back instead of closing the box (D27-162): a
    refusal to read in it, or the next question. Anything else closes it. */
export type Reply = { refused: string } | { next: Ask };

export interface Ask {
  title: string;
  body?: ReactNode;
  /** A typed answer - `required` for a reason, not for a note. Absent for
      a plain "are you sure?". */
  field?: { label: string; required: boolean; hint?: string };
  confirm: string;
  onConfirm: (text: string) => unknown;
  /** One button per answer, in place of the confirm (D27-162). */
  choices?: { label: string; onChoose: () => unknown }[];
}

/** A bill a restaurant bill can go to: the guest, and the company when the
    stay's bill is split and this one is the company's. */
export interface RoomBill { folioId: string; guest: string; company?: string | null }

/** CHARGING A BILL TO A ROOM, asked once (D27-117, D27-162).

    It asked "Charge ₹3,875 to room 201? Tanvi Bhide or Rekha Gaikwad will
    see it", closed on yes, and the server's "which of the two?" came back
    as a line in the corner nobody read - the owner's order stayed open and
    reached no bill (28 September). Now two open bills are the question
    itself, one button each, and a refusal is read in the same box. */
export function roomAsk(
  room: string, amount: string, bills: RoomBill[],
  charge: (folioId?: string) => Promise<TillResult | undefined>,
): Ask {
  const answer = async (folioId?: string): Promise<Reply | undefined> => {
    const res = await charge(folioId);
    if (!res || res.ok) return undefined;
    return res.choices ? { next: roomAsk(room, amount, res.choices, charge) } : { refused: res.reason };
  };
  const whose = (b: RoomBill) => (b.company ? `${b.guest} - bill to ${b.company}` : b.guest);
  const title = `Charge ${amount} to room ${room}?`;
  if (bills.length > 1) {
    return {
      title, body: `Room ${room} has ${bills.length} open bills. Whose is it?`,
      confirm: "", onConfirm: () => undefined,
      choices: bills.map((b) => ({ label: whose(b), onChoose: () => answer(b.folioId) })),
    };
  }
  return {
    title, ...(bills[0] ? { body: `${whose(bills[0])} will see it on their room bill.` } : {}),
    confirm: "Charge to room", onConfirm: () => answer(),
  };
}

export function AskDialog({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<Ask | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const shown = next ?? ask;
  const close = () => { setText(""); setNext(null); setRefused(null); onClose(); };
  const blocked = busy || (!!shown?.field?.required && !text.trim());

  const answer = async (act: () => unknown) => {
    setBusy(true);
    setRefused(null);
    let out: unknown;
    try { out = await act(); } finally { setBusy(false); }
    if (out && typeof out === "object" && "refused" in out) return setRefused((out as { refused: string }).refused);
    if (out && typeof out === "object" && "next" in out) return setNext((out as { next: Ask }).next);
    close();
  };
  const go = () => {
    if (!shown || blocked) return;
    void answer(() => shown.onConfirm(text.trim()));
  };

  return (
    <Dialog open={ask !== null} onOpenChange={(o) => { if (!o) close(); }}>
      {shown && (
        <DialogContent title={shown.title} size="sm">
          <div className="space-y-4">
            {shown.body && <div className="text-base text-grey-700">{shown.body}</div>}
            {shown.field && (
              <Field label={shown.field.label} {...(shown.field.hint ? { hint: shown.field.hint } : {})}>
                {(f) => (
                  <Textarea {...fieldProps(f)} rows={2} autoFocus value={text}
                            onChange={(e) => setText(e.target.value)} />
                )}
              </Field>
            )}
            {refused && <p role="alert" className="text-base text-brand-red-700">{refused}</p>}
            {shown.choices ? (
              <div className="space-y-2">
                {shown.choices.map((c) => (
                  <Button key={c.label} variant="secondary" className="h-12 w-full justify-start"
                          disabled={busy} onClick={() => void answer(c.onChoose)}>
                    {c.label}
                  </Button>
                ))}
                <DialogClose asChild>
                  <Button variant="ghost" className="h-12 w-full">Cancel</Button>
                </DialogClose>
              </div>
            ) : (
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
                </DialogClose>
                <Button variant="primary" className="h-12 flex-1" loading={busy}
                        disabled={blocked} onClick={go}>
                  {shown.confirm}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
