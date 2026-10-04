import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { money } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, toast, Dialog, DialogContent,
  Field, fieldProps, Input, NativeSelect, Switch,
} from "@/components/ui";
import {
  getExtraCharges, moneyList, setEarlyLateFees, type ExtraCharge, type Result,
} from "@/modules/finance/data/money";
import { MoneyList, Explained } from "./MoneyList";

/* ══════════════════════════════════════════════════════════════════
   EXTRA CHARGES (the owner's D27-259 Q3, Q6): the hotel's list of what a
   booking may add - priced, or included at no charge (a dash, never ₹0) -
   plus the early check-in and late check-out fees. A pickup or a drop is
   one marked so; its time and flight go in the booking's note. The bill's
   Add charge picks from this list. Extra adult and child rates are per
   room type, in Rates.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: Record<string, string> = {
  misc: "Other charges", food: "Food", beverage: "Beverage", spa: "Spa",
  laundry: "Laundry", minibar: "Minibar", telephone: "Telephone", room: "Room",
};
const price = (rate: number | null) => (rate === null ? "Included, no charge" : money(rate));

export default function ExtraChargesPage({ transport = false }: { transport?: boolean }) {
  const hotelId = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["extra-charges", hotelId], queryFn: () => getExtraCharges(hotelId) });
  const [editing, setEditing] = useState<ExtraCharge | "new" | null>(null);
  const list = moneyList(hotelId, "extra-charges");

  const done = async (res: Result, said: string) => {
    if (!res.ok) { toast.error("Not saved", res.reason); return false; }
    toast.success(said);
    await qc.invalidateQueries({ queryKey: ["extra-charges", hotelId] });
    return true;
  };

  const data = view.data;
  const rows = data?.charges.filter((c) => c.isTransport === transport) ?? [];
  return (
    <Page>
      <PageHeader title={transport ? "Pickup and drop" : "Extra charges"}
        description={transport
          ? "Airport, station and bus stand runs a booking may add, with the time in its note."
          : "What a booking may add, and the early check-in and late check-out fees."} />
      {!data ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          {!transport && (
            <EarlyLate hotelId={hotelId} early={data.earlyCheckinCharge} late={data.lateCheckoutCharge}
                       onSaved={(r) => done(r, "Saved")} />
          )}
          <MoneyList
            rows={rows}
            name={(c) => c.name}
            detail={(c) => `${price(c.rate)} · ${COLUMNS[c.category] ?? c.category}`}
            addLabel={transport ? "Add a pickup or drop" : "Add a charge"}
            onAdd={() => setEditing("new")}
            onToggle={(c, on) => void list.change(c.id, { isActive: on })
              .then((r) => done(r, on ? `${c.name} is On` : `${c.name} is Off`))}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => void list.remove(c.id).then((r) => done(r, `${c.name} deleted`))}
            onOrder={(ids) => void list.order(ids).then((r) => done(r, "Order saved"))}
            empty={transport ? "No pickup or drop yet." : "No extra charges yet."}
          />
          {editing && (
            <ChargeDialog row={editing === "new" ? null : editing} transport={transport}
              onClose={() => setEditing(null)}
              onSave={async (body) => {
                const res = editing === "new" ? await list.add(body) : await list.change(editing.id, body);
                if (await done(res, "Saved")) setEditing(null);
              }} />
          )}
        </div>
      )}
    </Page>
  );
}

/* Blank is "no charge for this", not ₹0 (063). */
const typed = (v: string) => (v.trim() === "" ? null : Number(v));

function EarlyLate({ hotelId, early, late, onSaved }: {
  hotelId: string; early: number | null; late: number | null; onSaved: (r: Result) => Promise<boolean>;
}) {
  const [e, setE] = useState(early === null ? "" : String(early));
  const [l, setL] = useState(late === null ? "" : String(late));
  const [busy, setBusy] = useState(false);
  const changed = typed(e) !== early || typed(l) !== late;
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Early check-in fee" hint="Blank: no fee.">
          {(f) => <Input {...fieldProps(f)} type="number" min={0} inputMode="decimal" value={e}
                         onChange={(ev) => setE(ev.target.value)} />}
        </Field>
        <Field label="Late check-out fee" hint="Blank: no fee.">
          {(f) => <Input {...fieldProps(f)} type="number" min={0} inputMode="decimal" value={l}
                         onChange={(ev) => setL(ev.target.value)} />}
        </Field>
        <Button variant="primary" className="h-11" disabled={busy || !changed}
          onClick={async () => {
            setBusy(true);
            await onSaved(await setEarlyLateFees(hotelId, { earlyCheckinCharge: typed(e), lateCheckoutCharge: typed(l) }));
            setBusy(false);
          }}>
          Save fees
        </Button>
      </CardBody>
    </Card>
  );
}

function ChargeDialog({ row, transport, onClose, onSave }: {
  row: ExtraCharge | null; transport: boolean;
  onClose: () => void;
  onSave: (body: { name: string; rate: number | null; category: string; isTransport: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [rate, setRate] = useState(row?.rate == null ? "" : String(row.rate));
  const [category, setCategory] = useState(row?.category ?? "misc");
  const [isTransport, setIsTransport] = useState(row?.isTransport ?? transport);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={row ? `Edit ${row.name}` : transport ? "Add a pickup or drop" : "Add a charge"}
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="h-11" disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                await onSave({ name: name.trim(), rate: typed(rate), category, isTransport });
                setBusy(false);
              }}>
              Save
            </Button>
          </>
        }>
        <Explained why={
          <>
            <p><b>The price</b> is what the desk adds to the bill: "Airport pickup ₹1,000".
              Leave it blank when the rate includes it at no charge - a welcome drink.</p>
            <p><b>The bill's column</b> is where the money lands in the reports: a cake under Food,
              a pickup under Other charges.</p>
          </>
        }>
          <Field label="Name">
            {(f) => <Input {...fieldProps(f)} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Price" hint="Blank: included at no charge.">
            {(f) => <Input {...fieldProps(f)} type="number" min={0} inputMode="decimal" value={rate}
                           onChange={(e) => setRate(e.target.value)} />}
          </Field>
          <Field label="Bill's column">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(COLUMNS).map(([k, words]) => <option key={k} value={k}>{words}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Switch checked={isTransport} onCheckedChange={setIsTransport} label="A pickup or a drop" />
        </Explained>
      </DialogContent>
    </Dialog>
  );
}
