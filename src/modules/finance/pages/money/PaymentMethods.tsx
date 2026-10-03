import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { getSession } from "@/lib/api";
import {
  Page, PageHeader, Button, Skeleton, toast, Dialog, DialogContent, Field, fieldProps,
  Input, NativeSelect,
} from "@/components/ui";
import {
  getPaymentMethods, moneyList, makeDefaultMethod, type PaymentMethodRow, type Result,
} from "@/modules/finance/data/money";
import { MoneyList, Explained } from "./MoneyList";

/* ══════════════════════════════════════════════════════════════════
   PAYMENT METHODS (the owner's D27-259 Q1, Q2): the hotel's own list.
   Each says what it is in the books - "Agoda" prints as Agoda and counts
   as Bill to company. The default is what the desk's payment screens start
   on; Front desk rules shows it. The screens and the payment door read
   this list, so a method switched Off is not offered or taken.
   ══════════════════════════════════════════════════════════════════ */

export default function PaymentMethodsPage() {
  const hotelId = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["payment-methods", hotelId], queryFn: () => getPaymentMethods(hotelId) });
  const [editing, setEditing] = useState<PaymentMethodRow | "new" | null>(null);
  const list = moneyList(hotelId, "payment-methods");

  /* The screens read the hotel's list from the session: fetch it again. */
  const done = async (res: Result, said: string) => {
    if (!res.ok) { toast.error("Not saved", res.reason); return false; }
    toast.success(said);
    await qc.invalidateQueries({ queryKey: ["payment-methods", hotelId] });
    const { hotels } = await getSession().catch(() => ({ hotels: null }));
    if (hotels) useSession.setState({ hotels });
    return true;
  };

  const data = view.data;
  return (
    <Page>
      <PageHeader title="Payment methods"
        description="How guests pay here: what the bill, New booking and a function's bill offer." />
      {!data ? <Skeleton className="h-64" /> : (
        <>
          <MoneyList
            rows={data.methods}
            name={(m) => m.label}
            detail={(m) => (
              <>
                {data.kinds[m.kind] ?? m.kind}
                {m.label === data.defaultMethod && (
                  <span className="ml-2 inline-flex items-center gap-1 text-brand-orange-700">
                    <Star className="size-3.5" aria-hidden /> Default
                  </span>
                )}
              </>
            )}
            addLabel="Add a method"
            onAdd={() => setEditing("new")}
            onToggle={(m, on) => void list.change(m.id, { isActive: on })
              .then((r) => done(r, on ? `${m.label} is On` : `${m.label} is Off`))}
            onEdit={(m) => setEditing(m)}
            onDelete={(m) => void list.remove(m.id).then((r) => done(r, `${m.label} deleted`))}
            onOrder={(ids) => void list.order(ids).then((r) => done(r, "Order saved"))}
            empty="No payment methods yet."
          />
          {editing && (
            <MethodDialog
              row={editing === "new" ? null : editing}
              kinds={data.kinds}
              isDefault={editing !== "new" && editing.label === data.defaultMethod}
              onClose={() => setEditing(null)}
              onSave={async (body) => {
                const res = editing === "new" ? await list.add(body) : await list.change(editing.id, body);
                if (await done(res, "Saved")) setEditing(null);
              }}
              onDefault={editing === "new" ? undefined : async () => {
                if (await done(await makeDefaultMethod(hotelId, editing.id), `${editing.label} is the default`)) {
                  setEditing(null);
                }
              }}
            />
          )}
        </>
      )}
    </Page>
  );
}

function MethodDialog({ row, kinds, isDefault, onClose, onSave, onDefault }: {
  row: PaymentMethodRow | null;
  kinds: Record<string, string>;
  isDefault: boolean;
  onClose: () => void;
  onSave: (body: { label: string; kind: string }) => Promise<void>;
  onDefault?: () => Promise<void>;
}) {
  const [label, setLabel] = useState(row?.label ?? "");
  const [kind, setKind] = useState(row?.kind ?? "");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); await f(); setBusy(false); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={row ? `Edit ${row.label}` : "Add a payment method"}
        footer={
          <>
            {onDefault && !isDefault && (
              <Button variant="secondary" className="h-11 mr-auto" disabled={busy || !row?.isActive}
                      onClick={() => void run(onDefault)}>
                Make default
              </Button>
            )}
            <Button variant="secondary" className="h-11" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy || !label.trim() || !kind}
                    onClick={() => void run(() => onSave({ label: label.trim(), kind }))}>
              Save
            </Button>
          </>
        }>
        <Explained why={
          <>
            <p><b>The name</b> is what the bill and the receipt print: "Agoda", "GoMMT", "Paytm".</p>
            <p><b>In the books</b> is where the reports count it. A booking site that collected the
              money is Bill to company: "Agoda ₹4,500" prints as Agoda and is owed by Agoda in the
              City ledger.</p>
          </>
        }>
          <Field label="Name">
            {(f) => <Input {...fieldProps(f)} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label="In the books">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="" disabled>Choose</option>
                {Object.entries(kinds).map(([k, words]) => <option key={k} value={k}>{words}</option>)}
              </NativeSelect>
            )}
          </Field>
          {isDefault && <p className="text-sm text-grey-600">The default: it stays On.</p>}
        </Explained>
      </DialogContent>
    </Dialog>
  );
}
