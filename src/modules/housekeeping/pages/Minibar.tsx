import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { GlassWater, Plus } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateTime, moneyPrecise } from "@/lib/format";
import {
  Page, PageHeader, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, StatusPill,
  Dialog, DialogContent, Field, Input, NativeSelect, Textarea, toast,
} from "@/components/ui";
import {
  getMinibar, addMinibarItem, changeMinibarItem, decideMinibar,
  type Minibar, type MinibarItem, type MinibarRecord,
} from "@/modules/housekeeping/data/housekeeping";
import { MinibarFlow } from "@/modules/housekeeping/flows/MinibarFlow";
import { ExportButtons, type ExportColumn } from "@/modules/reports";

/* The fortnight's records in a file (D27-383 item 1), waiting ones first,
   as listed. Nothing on the bill is a dash, never 0. */
const RECORD_EXPORT: ExportColumn<MinibarRecord>[] = [
  { label: "Room", value: (r) => r.room },
  { label: "Booking", value: (r) => r.reference },
  { label: "Guest", value: (r) => r.guest },
  { label: "Taken", value: (r) => r.lines.map((l) => `${l.name} x ${l.quantity}`).join(", ") },
  { label: "Status", value: (r) => (r.reversed ? "Taken off the bill" : r.status === "charged" ? "On the bill"
      : r.status === "waiting" ? (r.waitingWhy === "after_checkout" ? "Waiting: found after check-out" : "Waiting: not sure")
      : "Not charged") },
  { label: "Charged with tax", value: (r) => r.charged, kind: "money" },
  { label: "Recorded by", value: (r) => r.recordedBy },
  { label: "Recorded", value: (r) => r.recordedAt, kind: "datetime" },
  { label: "Decided by", value: (r) => r.decidedBy },
  { label: "Decided", value: (r) => r.decidedAt, kind: "datetime" },
  { label: "Note", value: (r) => r.decidedNote },
];

/* ══════════════════════════════════════════════════════════════════
   MINIBAR (D27-383 item 10, D27-396) - /h/:code/minibar

   Three parts, the first the desk's:
     Waiting for the desk - a take housekeeping was not sure of, or one
       found after the guest had left. Charge, or Not charged with why.
     Recorded - the last fortnight: on the bill, not charged, or taken off
       the bill (the bill's own Reverse - nothing here undoes a charge).
     The list - each item, its price (a dash until typed), its store and
       what that store holds. The owner, an administrator or the GM change it.
   ══════════════════════════════════════════════════════════════════ */

export default function MinibarPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const q = useQuery({ queryKey: ["minibar", hotelId], queryFn: () => getMinibar(hotelId) });
  const [recording, setRecording] = useState(false);
  const data = q.data;

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Minibar"
        description="What each room's minibar holds, what was taken, and what waits for the desk."
        actions={<>
          <ExportButtons screen="minibar" rows={data?.records} columns={RECORD_EXPORT}
            facts={[["Period", "the last 14 days"]]} />
          {data?.mayRecord && data.items.some((i) => i.active) && (
            <Button variant="primary" onClick={() => setRecording(true)}>
              <GlassWater className="size-4" /> Record for a room
            </Button>
          )}
        </>}
      />
      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24" /><Skeleton className="h-40" />
        </div>
      ) : q.error && !data ? (
        <Card><ErrorState title="The minibar did not load" error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : data ? (
        <div className="space-y-6">
          <Waiting hotelId={hotelId} data={data} />
          <Recorded records={data.records.filter((r) => r.status !== "waiting")} />
          <TheList hotelId={hotelId} data={data} />
          <MinibarFlow hotelId={hotelId} items={data.items} open={recording} onOpenChange={setRecording} />
        </div>
      ) : null}
    </Page>
  );
}

const what = (r: MinibarRecord) =>
  r.lines.map((l) => `${l.name}${l.quantity > 1 ? ` x ${l.quantity}` : ""}`).join(", ");
const beforeTax = (r: MinibarRecord) => r.lines.reduce((n, l) => n + l.price * l.quantity, 0);
const who = (name: string | null) => name ?? "-";

function Waiting({ hotelId, data }: { hotelId: string; data: Minibar }) {
  const waiting = data.records.filter((r) => r.status === "waiting");
  return (
    <section>
      <h2 className="text-md font-semibold text-ink-900 mb-3 flex items-center gap-2">
        Waiting for the desk <StatusPill tone={waiting.length ? "warning" : "neutral"}>{waiting.length}</StatusPill>
      </h2>
      {waiting.length === 0 ? (
        <Card><EmptyState compact title="Nothing waits for the desk" description="A take housekeeping is not sure of, or one found after the guest left, shows here." /></Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {waiting.map((r) => <WaitingCard key={r.id} hotelId={hotelId} record={r} mayDecide={data.mayDecide} />)}
        </ul>
      )}
    </section>
  );
}

function WaitingCard({ hotelId, record: r, mayDecide }: { hotelId: string; record: MinibarRecord; mayDecide: boolean }) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (charge: boolean) => {
    setBusy(true);
    const res = await decideMinibar(hotelId, r.id, charge ? { charge } : { charge, note });
    setBusy(false);
    if (!res.ok) return setSaid(res.reason);
    toast.success(charge ? `On room ${r.room}'s bill.` : "Not charged. The reason stays on the record.");
    setDeclining(false);
    await qc.invalidateQueries({ queryKey: ["minibar"] });
  };
  return (
    <li className="rounded-lg ring-1 ring-inset ring-brand-yellow-100 bg-brand-yellow-50 px-4 py-3" data-minibar-waiting={r.room}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-semibold text-ink-900 tabular">{r.room}</span>
        <StatusPill tone="warning">{r.waitingWhy === "after_checkout" ? "Found after check-out" : "Not sure"}</StatusPill>
      </div>
      <p className="text-base text-ink-900 mt-1">{what(r)}</p>
      <p className="text-sm text-grey-600 tabular">
        {moneyPrecise(beforeTax(r))} before tax · {r.guest ?? "-"}{r.reference ? ` (${r.reference})` : ""}
      </p>
      <p className="text-sm text-grey-500">{who(r.recordedBy)}, {dateTime(r.recordedAt)}</p>
      {mayDecide ? (
        declining ? (
          <div className="mt-3 space-y-2">
            <Textarea rows={2} aria-label="Why it is not charged" placeholder="Why it is not charged"
              value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeclining(false)}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={busy || !note.trim()} onClick={() => void decide(false)}>
                Not charged
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2 flex-wrap">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide(true)}>
              Charge to the bill
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeclining(true)}>Not charged</Button>
          </div>
        )
      ) : (
        <p className="mt-2 text-sm text-grey-600">The desk decides this.</p>
      )}
      <p role="status" className={said ? "mt-2 text-sm text-brand-red-700" : "sr-only"}>{said ?? ""}</p>
    </li>
  );
}

function Recorded({ records }: { records: MinibarRecord[] }) {
  return (
    <section>
      <h2 className="text-md font-semibold text-ink-900 mb-3">Recorded, the last 14 days</h2>
      <Card>
        {records.length === 0 ? (
          <EmptyState compact title="Nothing recorded yet" description="What housekeeping or the desk records from a room shows here." />
        ) : (
          <ul className="divide-y divide-grey-100">
            {records.map((r) => (
              <li key={r.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-minibar-record={r.room}>
                <span className="text-md font-semibold text-ink-900 tabular w-12">{r.room}</span>
                <span className="flex-1 min-w-[12rem] text-base text-ink-900">{what(r)}</span>
                <span className="text-sm text-grey-600 tabular">
                  {r.charged === null ? "-" : moneyPrecise(r.charged)}
                </span>
                {r.reversed ? <StatusPill tone="neutral">Taken off the bill</StatusPill>
                  : r.status === "charged" ? <StatusPill tone="success">On the bill</StatusPill>
                  : <StatusPill tone="neutral">Not charged</StatusPill>}
                <span className="basis-full text-sm text-grey-500">
                  {who(r.recordedBy)}, {dateTime(r.recordedAt)}
                  {r.decidedAt && ` · ${r.status === "charged" ? "charged" : "not charged"} by ${who(r.decidedBy)}`}
                  {r.decidedNote && `: ${r.decidedNote}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function TheList({ hotelId, data }: { hotelId: string; data: Minibar }) {
  const [editing, setEditing] = useState<MinibarItem | "new" | null>(null);
  return (
    <section>
      <Card>
        <CardHeader
          title="The list"
          description={data.mayKeep
            ? "Each item is a Store item. Its price is yours to type: an item with none cannot be charged."
            : "The owner, an administrator or the general manager change the list and its prices."}
          actions={data.mayKeep ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing("new")} disabled={data.stock.length === 0}>
              <Plus className="size-4" /> Add an item
            </Button>
          ) : undefined}
        />
        {data.items.length === 0 ? (
          <EmptyState compact title="No minibar list yet"
            description={data.mayKeep
              ? data.stock.length ? "Add the Store items a room's minibar holds." : "Add the items to the Store first, then here."
              : "The owner, an administrator or the general manager adds it."} />
        ) : (
          <ul className="divide-y divide-grey-100">
            {data.items.map((i) => (
              <li key={i.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1" data-minibar-list={i.name}>
                <span className="flex-1 min-w-[10rem] text-base text-ink-900">
                  {i.name} {i.alcohol && <StatusPill tone="neutral">VAT</StatusPill>}
                  {!i.active && <StatusPill tone="neutral">Off</StatusPill>}
                </span>
                <span className="text-base text-ink-900 tabular w-24 text-right">{i.price === null ? "-" : moneyPrecise(i.price)}</span>
                <span className="text-sm text-grey-500 tabular w-44">{i.store}: {i.onHand} {i.unit}</span>
                {data.mayKeep && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(i)}>Change</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <ItemDialog hotelId={hotelId} data={data} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function ItemDialog({ hotelId, data, item, onClose }: {
  hotelId: string; data: Minibar; item: MinibarItem | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [stockId, setStockId] = useState("");
  const chosen = data.stock.find((s) => s.id === stockId);
  /* A drink starts on the Bar store, anything else on the Main store. */
  const startStore = (alcohol: boolean) =>
    (data.stores.find((s) => (alcohol ? s.bar : s.name === "Main store")) ?? data.stores[0])?.id ?? "";
  const [storeId, setStoreId] = useState(item?.storeId ?? "");
  const [price, setPrice] = useState(item?.price === null || !item ? "" : String(item.price));
  const [active, setActive] = useState(item?.active ?? true);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = item
      ? await changeMinibarItem(hotelId, item.id, { price, storeId, active })
      : await addMinibarItem(hotelId, { stockItemId: stockId, price, storeId });
    setBusy(false);
    if (!res.ok) return setSaid(res.reason);
    toast.success(item ? `${item.name} is changed.` : `${chosen?.name ?? "It"} is on the minibar list.`);
    await qc.invalidateQueries({ queryKey: ["minibar"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={item ? item.name : "Add an item to the minibar"}
        description="The price is what the guest pays before tax. Leave it empty until it is decided: it cannot be charged until then."
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (!item && !stockId) || !storeId} onClick={() => void save()}>
            {item ? "Save" : "Add to the minibar"}
          </Button>
        </>}
      >
        <div className="space-y-4">
          {!item && (
            <Field label="Store item" required>
              {({ id }) => (
                <NativeSelect id={id} value={stockId} onChange={(e) => {
                  setStockId(e.target.value);
                  const s = data.stock.find((x) => x.id === e.target.value);
                  if (s) setStoreId(startStore(s.alcohol));
                }}>
                  <option value="">Choose one</option>
                  {data.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </NativeSelect>
              )}
            </Field>
          )}
          <Field label="Price, before tax" hint="In rupees. Empty: no price yet">
            {({ id }) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="-" />}
          </Field>
          <Field label="Refilled from" required>
            {({ id }) => (
              <NativeSelect id={id} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Choose a store</option>
                {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          {item && (
            <Field label="On the list">
              {({ id }) => (
                <NativeSelect id={id} value={active ? "on" : "off"} onChange={(e) => setActive(e.target.value === "on")}>
                  <option value="on">On - housekeeping counts it</option>
                  <option value="off">Off - not in the minibar any more</option>
                </NativeSelect>
              )}
            </Field>
          )}
          <p role="status" className={said ? "text-sm text-brand-red-700" : "sr-only"}>{said ?? ""}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
