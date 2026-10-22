import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { Button, Dialog, DialogContent, Field, fieldProps, Input, toast } from "@/components/ui";
import { openParcel, type Order } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   NEW PARCEL (the owner's D27-359)

   A parcel has no table: it is named by its customer - required, so two
   parcels can be told apart - with a phone to call when it is ready. The
   order opens empty, as "Parcel · <name>", and the screen that asked takes
   it from there (Tables opens its pad, the Till and the Terminal open it).
   ══════════════════════════════════════════════════════════════════ */

export function NewParcel({ hotelId, outlet, onOpened, className, large = false }: {
  hotelId: string; outlet: string; onOpened: (order: Order) => void;
  className?: string; large?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => { setOpen(false); setName(""); setPhone(""); setProblem(null); };
  const create = async () => {
    if (!name.trim()) return setProblem("Whose parcel is it? Type the customer's name.");
    setBusy(true);
    const res = await openParcel(hotelId, outlet, name.trim(), phone);
    setBusy(false);
    if (!res.ok) return setProblem(res.reason);
    toast.success(`Parcel for ${name.trim()}`, "Add the dishes and send them to the kitchen.");
    close();
    onOpened(res.order);
  };

  return (
    <>
      {large ? (
        <button type="button" onClick={() => setOpen(true)}
          className={className ?? "press w-full h-16 rounded-full border border-grey-300 bg-white text-ink-900 text-lg font-semibold hover:border-grey-400 hover:bg-grey-50 cursor-pointer flex items-center justify-center gap-2"}>
          <ShoppingBag className="size-5" aria-hidden /> New parcel
        </button>
      ) : (
        <Button variant="secondary" size="lg" leadingIcon={<ShoppingBag />} className={className}
          onClick={() => setOpen(true)}>New parcel</Button>
      )}
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent
          title="New parcel"
          className="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => void create()}>Open the parcel</Button>
            </>
          }
        >
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <Field label="Customer's name">
              {(p) => <Input {...fieldProps(p)} value={name} maxLength={60} autoFocus
                onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Phone" hint="To call when it is ready. Not needed.">
              {(p) => <Input {...fieldProps(p)} value={phone} inputMode="tel"
                onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
