import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { money } from "@/lib/format";
import {
  Page, PageHeader, Button, Skeleton, toast, Dialog, DialogContent, Field, fieldProps,
  Input, Segmented,
} from "@/components/ui";
import { getDiscounts, moneyList, type Discount, type Result } from "@/modules/finance/data/money";
import { MoneyList, Explained } from "./MoneyList";

/* ══════════════════════════════════════════════════════════════════
   ROOM DISCOUNTS (the owner's D27-259 Q4): named promotions, a percentage
   or rupees off each night. By hand, the desk gives up to 10% of a night
   with a reason; more only through one of these.
   ══════════════════════════════════════════════════════════════════ */

const off = (d: Discount) => (d.percent !== null ? `${d.percent}% off each night` : `${money(d.amount ?? 0)} off each night`);

export default function DiscountsPage() {
  const hotelId = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["discounts", hotelId], queryFn: () => getDiscounts(hotelId) });
  const [editing, setEditing] = useState<Discount | "new" | null>(null);
  const list = moneyList(hotelId, "discounts");

  const done = async (res: Result, said: string) => {
    if (!res.ok) { toast.error("Not saved", res.reason); return false; }
    toast.success(said);
    await qc.invalidateQueries({ queryKey: ["discounts", hotelId] });
    await qc.invalidateQueries({ queryKey: ["room-promotions", hotelId] });
    return true;
  };

  return (
    <Page>
      {/* D27-395: named "Room discounts" so nobody looks for the restaurant's here. */}
      <PageHeader title="Room discounts"
        description="Named discounts on rooms for New booking: a percentage or rupees off each night. The restaurant's discounts are Promotions, in Point of sale → Menu." />
      {!view.data ? <Skeleton className="h-64" /> : (
        <>
          <MoneyList
            rows={view.data.discounts}
            name={(d) => d.name}
            detail={off}
            addLabel="Add a discount"
            onAdd={() => setEditing("new")}
            onToggle={(d, on) => void list.change(d.id, { isActive: on })
              .then((r) => done(r, on ? `${d.name} is On` : `${d.name} is Off`))}
            onEdit={(d) => setEditing(d)}
            onDelete={(d) => void list.remove(d.id).then((r) => done(r, `${d.name} deleted`))}
            empty="No named discounts yet."
          />
          {editing && (
            <DiscountDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)}
              onSave={async (body) => {
                const res = editing === "new" ? await list.add(body) : await list.change(editing.id, body);
                if (await done(res, "Saved")) setEditing(null);
              }} />
          )}
        </>
      )}
    </Page>
  );
}

function DiscountDialog({ row, onClose, onSave }: {
  row: Discount | null; onClose: () => void;
  onSave: (body: { name: string; percent: number | null; amount: number | null }) => Promise<void>;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [by, setBy] = useState<"percent" | "amount">(row?.amount != null ? "amount" : "percent");
  const [value, setValue] = useState(String(row?.percent ?? row?.amount ?? ""));
  const [busy, setBusy] = useState(false);
  const n = Number(value);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={row ? `Edit ${row.name}` : "Add a discount"}
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy || !name.trim() || !(n > 0)}
              onClick={async () => {
                setBusy(true);
                await onSave({ name: name.trim(), percent: by === "percent" ? n : null, amount: by === "amount" ? n : null });
                setBusy(false);
              }}>
              Save
            </Button>
          </>
        }>
        <Explained why={
          <>
            <p><b>Off each night</b>: on a ₹4,000 night, 25% leaves ₹3,000; ₹500 leaves ₹3,500.
              GST is worked out on what is left.</p>
            <p>By hand the desk may give up to 10% of a night with a reason. A bigger discount is
              given only by picking one of these.</p>
          </>
        }>
          <Field label="Name">
            {(f) => <Input {...fieldProps(f)} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Segmented value={by} onChange={setBy}
            options={[{ value: "percent", label: "%" }, { value: "amount", label: "₹" }]} />
          <Field label={by === "percent" ? "Percent off each night" : "Rupees off each night"}>
            {(f) => <Input {...fieldProps(f)} type="number" min={0} inputMode="decimal" value={value}
                           onChange={(e) => setValue(e.target.value)} />}
          </Field>
        </Explained>
      </DialogContent>
    </Dialog>
  );
}
