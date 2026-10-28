import { useRef, useState } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import { Button, Dialog, DialogContent, Field, fieldProps, NativeSelect, toast } from "@/components/ui";
import { EXPENSE_CATEGORIES, attachExpensePhoto, expensePhoto } from "@/modules/finance/data/expenses";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK ON A PAID-OUT (the owner's D27-370)

   The same two fields in the restaurant's Cash step and the desk's
   Cashiering: the category (one of five, required) and the photo of the
   bill (optional - whether it is required is the owner's question). Then,
   on each paid-out in the list, its photo to open, or one to add later.
   ══════════════════════════════════════════════════════════════════ */

export function ExpenseFields({ category, onCategory, onFile }: {
  category: string; onCategory: (c: string) => void; onFile: (f: File | null) => void;
}) {
  return (
    <>
      <Field label="Category">
        {(f) => (
          <NativeSelect {...fieldProps(f)} value={category}
            onChange={(e) => onCategory(e.target.value)} className="h-12 text-base">
            <option value="" disabled>Choose one</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Photo of the bill" hint="Take it with the phone's camera, or pick a file. It can be added later.">
        {(f) => (
          <label className="flex items-center gap-2 text-sm text-ink-900 cursor-pointer">
            <Camera className="size-4 text-grey-500" />
            <input id={f.id} aria-describedby={f.describedBy} type="file" accept="image/*,application/pdf"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </label>
        )}
      </Field>
    </>
  );
}

/** A paid-out's photo: open it, or add one now. */
export function ExpensePhoto({ path, photo, title, onAdded }: {
  path: string; photo: boolean; title: string; onAdded: () => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = async () => {
    const got = await expensePhoto(path);
    if (!got.ok) return void toast.error("Not opened", got.reason);
    setShown(got.url);
  };
  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const res = await attachExpensePhoto(path, file);
    setBusy(false);
    if (!res.ok) return void toast.error("Photo not saved", res.reason);
    toast.success("Photo saved");
    onAdded();
  };

  return (
    <>
      {photo ? (
        <Button size="sm" variant="secondary" leadingIcon={<ImageIcon />} onClick={() => void open()}>
          Photo of the bill
        </Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" leadingIcon={<Camera />} disabled={busy}
            onClick={() => input.current?.click()}>
            {busy ? "Saving…" : "Add photo"}
          </Button>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden"
            aria-label={`Add photo - ${title}`}
            onChange={(e) => void add(e.target.files?.[0])} />
        </>
      )}
      <Dialog open={shown !== null} onOpenChange={(o) => { if (!o) setShown(null); }}>
        <DialogContent title={title} className="max-w-3xl">
          {shown && <img src={shown} alt={title} className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
