import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useUi } from "@/lib/ui";
import { addDays, dateShort, moneyPrecise } from "@/lib/format";
import { downloadCsv, reportFilename, toCsv } from "@/lib/csv";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, DataTable, type Column,
  Tabs, TabsList, TabsTrigger, TabsContent, Dialog, DialogContent, Field, fieldProps, Input,
  NativeSelect, Textarea, Checkbox, StatusPill, Menu, MenuItem, MenuSeparator, toast,
} from "@/components/ui";
import { ReturningGuest, ID_TYPES } from "@/modules/guests";
import {
  getBackfill, addBackfill, correctBackfill, removeBackfill,
  type BackfillView, type BackfillKind, type BackfillStay, type BackfillBill, type BackfillCash,
} from "@/modules/admin/data/backfill";
import { daySummary, totalOf, methodsIn, type DayRow } from "./summary";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → BACKFILL DATA (the owner's D27-398)

   What happened before this hotel's first day in the system - the
   essentials of each stay, restaurant bill and cash line, from the hotel's
   paper records - in a register of its own. Nothing here is a booking, a
   bill or an invoice, so no live screen, report, night audit, Form C list,
   drawer or Tally file counts it. Three tabs, each a list by date with Add,
   Correct and Remove (each with a reason; a removed line stays, marked),
   a day-by-day summary, and a CSV of each.

   WHO: the owner, an Admin and the GM write; the Accountant reads (the
   server's own answer, `mayWrite`). A figure nobody typed is a dash.
   ══════════════════════════════════════════════════════════════════ */

const DASH = "-";
const fig = (v: number | null | undefined) => (v === null || v === undefined ? DASH : moneyPrecise(v));
const csvFig = (v: number | null | undefined) => (v === null || v === undefined ? DASH : v.toFixed(2));
const ID_WORDS: Record<string, string> = Object.fromEntries(ID_TYPES);
const READ_ONLY = "Only the owner, an administrator or the general manager enters and corrects these.";
/** Blank is "not typed", never zero. */
const typed = (v: string) => (v.trim() === "" ? null : Number(v));
const shown = (v: number | null) => (v === null ? "" : String(v));

export default function BackfillPage() {
  const hotelId = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["backfill", hotelId], queryFn: () => getBackfill(hotelId), enabled: !!hotelId });
  const [editing, setEditing] = useState<{ kind: BackfillKind; row: unknown | null } | null>(null);
  const [removing, setRemoving] = useState<{ kind: BackfillKind; id: string; what: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backfill", hotelId] });

  const header = (
    <PageHeader title="Backfill data"
      description="What happened before this hotel's first day in the system: stays, restaurant bills and cash, from the hotel's own records." />
  );
  if (view.isLoading) return <Page>{header}<Skeleton className="h-80" /></Page>;
  if (view.error || !view.data) {
    return <Page>{header}<Card><ErrorState error={view.error} onRetry={() => void view.refetch()} /></Card></Page>;
  }
  const v = view.data;
  const live = (rows: { removedAt: string | null }[]) => rows.filter((r) => !r.removedAt).length;
  const file = (what: string) => reportFilename(hotelId, `backfill ${what}`, `before ${v.firstDay}`);

  return (
    <Page>
      {header}
      <Card className="mb-4">
        <CardBody className="space-y-1 text-base">
          <p>
            <span className="font-medium">First day in the system: {dateShort(v.firstDay)}.</span>{" "}
            Only what happened before it is entered here; from that day on, use the normal screens.
          </p>
          <p className="text-sm text-grey-600">
            Kept apart from the live books: the night audit, reports, tax invoices, Form C, the cash drawers
            and Tally never count these. The hotel's own paper bill number is recorded; no new invoice is made.
          </p>
          {!v.mayWrite && <p className="text-sm text-grey-600">You can read these. {READ_ONLY}</p>}
        </CardBody>
      </Card>

      <Tabs defaultValue="stays">
        <TabsList>
          <TabsTrigger value="stays" count={live(v.stays)}>Stays</TabsTrigger>
          <TabsTrigger value="bills" count={live(v.bills)}>Restaurant bills</TabsTrigger>
          <TabsTrigger value="cash" count={live(v.cash)}>Cash</TabsTrigger>
          <TabsTrigger value="summary">Day by day</TabsTrigger>
        </TabsList>

        <TabsContent value="stays">
          <Toolbar mayWrite={v.mayWrite} addLabel="Add a stay" onAdd={() => setEditing({ kind: "stays", row: null })}
            onExport={() => downloadCsv(file("stays"), staysCsv(v.stays))} />
          <DataTable<BackfillStay> rows={v.stays} rowKey={(s) => s.id}
            columns={stayColumns(v, (row) => setEditing({ kind: "stays", row }),
              (s) => setRemoving({ kind: "stays", id: s.id, what: `${s.guestName}'s stay` }))}
            empty={<Empty words="No stays backfilled yet." />} />
        </TabsContent>

        <TabsContent value="bills">
          <Toolbar mayWrite={v.mayWrite} addLabel="Add a restaurant bill"
            blocked={v.outlets.length ? null : "No restaurant is set up at this hotel yet."}
            onAdd={() => setEditing({ kind: "bills", row: null })}
            onExport={() => downloadCsv(file("restaurant bills"), billsCsv(v.bills))} />
          <DataTable<BackfillBill> rows={v.bills} rowKey={(b) => b.id}
            columns={billColumns(v, (row) => setEditing({ kind: "bills", row }),
              (b) => setRemoving({ kind: "bills", id: b.id, what: `bill ${b.billNumber ?? DASH}` }))}
            empty={<Empty words="No restaurant bills backfilled yet." />} />
        </TabsContent>

        <TabsContent value="cash">
          <Toolbar mayWrite={v.mayWrite} addLabel="Add cash in or out" onAdd={() => setEditing({ kind: "cash", row: null })}
            onExport={() => downloadCsv(file("cash"), cashCsv(v.cash))} />
          <DataTable<BackfillCash> rows={v.cash} rowKey={(c) => c.id}
            columns={cashColumns(v, (row) => setEditing({ kind: "cash", row }),
              (c) => setRemoving({ kind: "cash", id: c.id, what: `the cash line "${c.purpose}"` }))}
            empty={<Empty words="No cash backfilled yet." />} />
        </TabsContent>

        <TabsContent value="summary">
          <Summary v={v} onExport={(csv) => downloadCsv(file("day by day"), csv)} />
        </TabsContent>
      </Tabs>

      {editing?.kind === "stays" && (
        <StayDialog v={v} hotelId={hotelId} row={editing.row as BackfillStay | null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
      )}
      {editing?.kind === "bills" && (
        <BillDialog v={v} hotelId={hotelId} row={editing.row as BackfillBill | null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
      )}
      {editing?.kind === "cash" && (
        <CashDialog v={v} hotelId={hotelId} row={editing.row as BackfillCash | null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
      )}
      {removing && (
        <RemoveDialog what={removing.what} onClose={() => setRemoving(null)}
          onRemove={async (reason) => {
            const res = await removeBackfill(hotelId, removing.kind, removing.id, reason);
            if (!res.ok) { toast.error("Not removed", res.reason); return; }
            toast.success("Removed", "It stays on the list, marked removed.");
            setRemoving(null);
            void refresh();
          }} />
      )}
    </Page>
  );
}

function Empty({ words }: { words: string }) {
  return <p className="p-6 text-center text-base text-grey-500">{words}</p>;
}

function Toolbar({ mayWrite, addLabel, onAdd, onExport, blocked = null }: {
  mayWrite: boolean; addLabel: string; onAdd: () => void; onExport: () => void; blocked?: string | null;
}) {
  const why = mayWrite ? blocked : READ_ONLY;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="primary" className="h-10" disabled={!!why} onClick={onAdd}>
        <Plus className="size-4" /> {addLabel}
      </Button>
      <Button variant="secondary" className="h-10" onClick={onExport}>
        <Download className="size-4" /> Export CSV
      </Button>
      {why && <span className="text-sm text-grey-600">{why}</span>}
    </div>
  );
}

/** The trail: who entered it, the last correction, and a removal. */
function trailWords(r: { enteredBy: string | null; changeReason: string | null; changedBy: string | null;
  removedReason: string | null; removedBy: string | null }): ReactNode {
  return (
    <span className="text-sm text-grey-600">
      {r.removedReason ? `Removed by ${r.removedBy ?? DASH}: ${r.removedReason}`
        : r.changeReason ? `Corrected by ${r.changedBy ?? DASH}: ${r.changeReason}`
        : `Entered by ${r.enteredBy ?? DASH}`}
    </span>
  );
}

function actions<T extends { removedAt: string | null }>(
  v: BackfillView, row: T, onCorrect: (row: T) => void, onRemove: (row: T) => void,
): ReactNode {
  const why = !v.mayWrite ? READ_ONLY : row.removedAt ? "A removed line stays as it was." : undefined;
  return (
    <Menu>
      <MenuItem icon={Pencil} disabled={!!why} reason={why} onSelect={() => onCorrect(row)}>Correct</MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash2} danger disabled={!!why} reason={why} onSelect={() => onRemove(row)}>Remove</MenuItem>
    </Menu>
  );
}

const removedPill = (r: { removedAt: string | null }) =>
  r.removedAt ? <StatusPill tone="neutral">Removed</StatusPill> : null;

function messageWords(s: BackfillStay): ReactNode {
  if (!s.sendBill) return DASH;
  if (s.message?.status === "sent") return <StatusPill tone="success">Sent {s.message.at ?? ""}</StatusPill>;
  return <StatusPill tone="danger">Not sent</StatusPill>;
}

function stayColumns(v: BackfillView, onCorrect: (s: BackfillStay) => void, onRemove: (s: BackfillStay) => void): Column<BackfillStay>[] {
  return [
    { key: "dates", header: "Dates", cell: (s) => (
      <span className={s.removedAt ? "tabular line-through text-grey-500" : "tabular"}>
        {dateShort(s.arrival)} – {dateShort(s.departure)}
      </span>) },
    { key: "room", header: "Room", cell: (s) => <span className="tabular">{s.room}</span> },
    { key: "guest", header: "Guest", cell: (s) => (
      <span className="flex flex-col">
        <span className="font-medium">{s.guestName} {removedPill(s)}</span>
        <span className="text-sm text-grey-600">
          {ID_WORDS[s.idType] ?? s.idType} {s.idNumber ?? ""}
          {s.nationality !== "IN" && ` · ${s.nationality} · ${s.formCReference ? `Form C ${s.formCReference}` : "Form C not recorded"}`}
        </span>
      </span>) },
    { key: "charges", header: "Room charges", numeric: true, cell: (s) => fig(s.roomCharges) },
    { key: "gst", header: "GST", numeric: true, hideBelow: "md", cell: (s) => fig(s.gst) },
    { key: "other", header: "Other", numeric: true, hideBelow: "lg", cell: (s) => fig(s.otherCharges) },
    { key: "paid", header: "Paid", numeric: true, hideBelow: "md",
      cell: (s) => (s.paid === null ? DASH : `${fig(s.paid)} ${s.paidBy}`) },
    { key: "bill", header: "Hotel's bill", hideBelow: "lg", cell: (s) => s.billNumber ?? DASH },
    { key: "sent", header: "Bill sent", hideBelow: "xl", cell: messageWords },
    { key: "who", header: "Entered", hideBelow: "xl", cell: trailWords },
    { key: "act", header: "", width: "w-[150px]", cell: (s) => actions(v, s, onCorrect, onRemove) },
  ];
}

function billColumns(v: BackfillView, onCorrect: (b: BackfillBill) => void, onRemove: (b: BackfillBill) => void): Column<BackfillBill>[] {
  return [
    { key: "date", header: "Date", cell: (b) => (
      <span className={b.removedAt ? "tabular line-through text-grey-500" : "tabular"}>{dateShort(b.billDate)}</span>) },
    { key: "outlet", header: "Restaurant", cell: (b) => <span>{b.outlet} {removedPill(b)}</span> },
    { key: "number", header: "Hotel's bill", cell: (b) => b.billNumber ?? DASH },
    { key: "amount", header: "Before GST", numeric: true, hideBelow: "md", cell: (b) => fig(b.amount) },
    { key: "gst", header: "GST", numeric: true, hideBelow: "md", cell: (b) => fig(b.gst) },
    { key: "total", header: "Total", numeric: true, cell: (b) => fig(b.total) },
    { key: "paid", header: "Paid by", hideBelow: "lg", cell: (b) => b.paidBy ?? DASH },
    { key: "note", header: "Note", hideBelow: "xl", cell: (b) => b.note ?? DASH },
    { key: "who", header: "Entered", hideBelow: "xl", cell: trailWords },
    { key: "act", header: "", width: "w-[150px]", cell: (b) => actions(v, b, onCorrect, onRemove) },
  ];
}

function cashColumns(v: BackfillView, onCorrect: (c: BackfillCash) => void, onRemove: (c: BackfillCash) => void): Column<BackfillCash>[] {
  return [
    { key: "date", header: "Date", cell: (c) => (
      <span className={c.removedAt ? "tabular line-through text-grey-500" : "tabular"}>{dateShort(c.cashDate)}</span>) },
    { key: "dir", header: "In or out", cell: (c) => <span>{c.direction === "in" ? "Money in" : "Money out"} {removedPill(c)}</span> },
    { key: "amount", header: "Amount", numeric: true, cell: (c) => fig(c.amount) },
    { key: "purpose", header: "What for", cell: (c) => c.purpose },
    { key: "person", header: "Who", hideBelow: "md", cell: (c) => c.person },
    { key: "who", header: "Entered", hideBelow: "xl", cell: trailWords },
    { key: "act", header: "", width: "w-[150px]", cell: (c) => actions(v, c, onCorrect, onRemove) },
  ];
}

/* ── The day-by-day summary ───────────────────────────────────────── */

function Summary({ v, onExport }: { v: BackfillView; onExport: (csv: string) => void }) {
  const days = daySummary(v.stays, v.bills, v.cash);
  const methods = methodsIn(days);
  const total = { date: "Total", ...totalOf(days) } as DayRow;
  const rows = days.length ? [...days, total] : [];
  const columns: Column<DayRow>[] = [
    { key: "date", header: "Day", cell: (r) => <span className={r.date === "Total" ? "font-medium" : "tabular"}>
      {r.date === "Total" ? "Total" : dateShort(r.date)}</span> },
    { key: "rooms", header: "Rooms sold", numeric: true, cell: (r) => r.roomsSold },
    { key: "charges", header: "Room charges", numeric: true, cell: (r) => fig(r.roomCharges) },
    { key: "gst", header: "GST", numeric: true, cell: (r) => fig(r.gst) },
    { key: "other", header: "Other charges", numeric: true, hideBelow: "md", cell: (r) => fig(r.otherCharges) },
    { key: "food", header: "Restaurant sales", numeric: true, hideBelow: "md", cell: (r) => fig(r.restaurantSales) },
    { key: "foodGst", header: "Restaurant GST", numeric: true, hideBelow: "lg", cell: (r) => fig(r.restaurantGst) },
    ...methods.map((m): Column<DayRow> => ({ key: `pay-${m}`, header: m, numeric: true, hideBelow: "lg",
      cell: (r) => fig(r.payments[m] ?? null) })),
    { key: "in", header: "Cash in", numeric: true, hideBelow: "md", cell: (r) => fig(r.cashIn) },
    { key: "out", header: "Cash out", numeric: true, hideBelow: "md", cell: (r) => fig(r.cashOut) },
  ];
  const csv = () => toCsv(
    ["Day", "Rooms sold", "Room charges", "GST", "Other charges", "Restaurant sales", "Restaurant GST",
     ...methods.map((m) => `Paid by ${m}`), "Cash in", "Cash out"],
    rows.map((r) => [r.date, r.roomsSold, csvFig(r.roomCharges), csvFig(r.gst), csvFig(r.otherCharges),
      csvFig(r.restaurantSales), csvFig(r.restaurantGst), ...methods.map((m) => csvFig(r.payments[m])),
      csvFig(r.cashIn), csvFig(r.cashOut)]));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="h-10" onClick={() => onExport(csv())}>
          <Download className="size-4" /> Export CSV
        </Button>
        <span className="text-sm text-grey-600">
          Rooms sold count each night; a stay's charges and payment count on its last night. Removed lines are left out.
        </span>
      </div>
      <DataTable<DayRow> rows={rows} rowKey={(r) => r.date} columns={columns}
        empty={<Empty words="Nothing backfilled yet: the summary fills in as stays, bills and cash are added." />} />
    </>
  );
}

/* ── CSV of each tab: what the screen shows, a dash for a figure not typed ── */

const trailCells = (r: { enteredBy: string | null; changedBy: string | null; changeReason: string | null;
  removedBy: string | null; removedReason: string | null }) =>
  [r.enteredBy ?? DASH, r.changedBy ?? DASH, r.changeReason ?? DASH, r.removedBy ?? DASH, r.removedReason ?? DASH];
const TRAIL = ["Entered by", "Corrected by", "Correction reason", "Removed by", "Removal reason"];

const staysCsv = (rows: BackfillStay[]) => toCsv(
  ["Arrival", "Departure", "Room", "Guest", "Phone", "Email", "Nationality", "ID type", "ID number",
   "Visa or OCI number", "Form C reference", "Adults", "Children", "Rate a night", "Room charges", "GST",
   "Other charges", "Other charges for", "Paid", "Paid by", "Hotel's bill number", "Bill sent", ...TRAIL],
  rows.map((s) => [s.arrival, s.departure, s.room, s.guestName, s.phone ?? DASH, s.email ?? DASH, s.nationality,
    ID_WORDS[s.idType] ?? s.idType, s.idNumber ?? DASH, s.visaNumber ?? DASH,
    s.nationality === "IN" ? DASH : s.formCReference ?? "Form C not recorded", s.adults, s.children,
    csvFig(s.rate), csvFig(s.roomCharges), csvFig(s.gst), csvFig(s.otherCharges), s.otherChargesFor ?? DASH,
    csvFig(s.paid), s.paidBy ?? DASH, s.billNumber ?? DASH,
    !s.sendBill ? DASH : s.message?.status === "sent" ? "Sent" : "Not sent", ...trailCells(s)]));

const billsCsv = (rows: BackfillBill[]) => toCsv(
  ["Date", "Restaurant", "Hotel's bill number", "Before GST", "GST", "Total", "Paid by", "Note", ...TRAIL],
  rows.map((b) => [b.billDate, b.outlet, b.billNumber ?? DASH, csvFig(b.amount), csvFig(b.gst), csvFig(b.total),
    b.paidBy ?? DASH, b.note ?? DASH, ...trailCells(b)]));

const cashCsv = (rows: BackfillCash[]) => toCsv(
  ["Date", "In or out", "Amount", "What for", "Who", ...TRAIL],
  rows.map((c) => [c.cashDate, c.direction === "in" ? "Money in" : "Money out", csvFig(c.amount), c.purpose,
    c.person, ...trailCells(c)]));

/* ── The dialogs ──────────────────────────────────────────────────── */

/** Save, and say what the server said. */
async function saved(
  res: { ok: true; sent?: true | string | null } | { ok: false; reason: string }, onSaved: () => void,
) {
  if (!res.ok) { toast.error("Not saved", res.reason); return; }
  if (res.sent === true) toast.success("Saved", "The bill and thank-you went to the guest by email.");
  else if (typeof res.sent === "string") toast.warning("Saved, but the bill was not sent", res.sent);
  else toast.success("Saved");
  onSaved();
}

function FormDialog({ title, busy, ready, onClose, onSave, children, correcting, reason, setReason }: {
  title: string; busy: boolean; ready: boolean; onClose: () => void; onSave: () => void; children: ReactNode;
  correcting: boolean; reason: string; setReason: (r: string) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={title}
        footer={<>
          <Button variant="secondary" className="h-11" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="h-11" disabled={busy || !ready || (correcting && !reason.trim())}
            onClick={onSave}>Save</Button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {children}
          {correcting && (
            <Field label="Why it is being corrected" required className="sm:col-span-2"
              hint="Kept with the record and in the audit log.">
              {(f) => <Textarea {...fieldProps(f)} rows={2} maxLength={300} value={reason}
                                onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Money({ label, value, set, hint }: { label: string; value: string; set: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? "Blank: not recorded (a dash)."}>
      {(f) => <Input {...fieldProps(f)} type="number" min={0} step="0.01" inputMode="decimal" value={value}
                     onChange={(e) => set(e.target.value)} />}
    </Field>
  );
}

function Method({ v, value, set, label = "Paid by" }: { v: BackfillView; value: string; set: (m: string) => void; label?: string }) {
  return (
    <Field label={label}>
      {(f) => (
        <NativeSelect {...fieldProps(f)} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Not recorded</option>
          {v.methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </NativeSelect>
      )}
    </Field>
  );
}

function StayDialog({ v, hotelId, row, onClose, onSaved }: {
  v: BackfillView; hotelId: string; row: BackfillStay | null; onClose: () => void; onSaved: () => void;
}) {
  const last = addDays(v.firstDay, -1);
  const [f, setF] = useState({
    guestName: row?.guestName ?? "", phone: row?.phone ?? "", email: row?.email ?? "",
    nationality: row?.nationality ?? "IN", idType: row?.idType ?? "aadhaar", idNumber: "",
    visaNumber: row?.visaNumber ?? "", formCReference: row?.formCReference ?? "",
    roomId: row?.roomId ?? v.rooms[0]?.id ?? "", arrival: row?.arrival ?? "", departure: row?.departure ?? "",
    adults: String(row?.adults ?? 1), children: String(row?.children ?? 0),
    rate: shown(row?.rate ?? null), roomCharges: shown(row?.roomCharges ?? null), gst: shown(row?.gst ?? null),
    otherCharges: shown(row?.otherCharges ?? null), otherChargesFor: row?.otherChargesFor ?? "",
    paid: shown(row?.paid ?? null), paidBy: row?.paidBy ?? "", billNumber: row?.billNumber ?? "",
  });
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [sendBill, setSendBill] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [key]: value }));
  const foreign = f.nationality.trim().toUpperCase() !== "IN";
  const sendWhy = !v.sending.ok ? v.sending.reason
    : !f.email.trim() ? "Type the guest's email first: it goes by email." : null;

  const body = {
    ...f, nationality: f.nationality.trim().toUpperCase() || "IN", idType: foreign ? "passport" : f.idType,
    adults: Number(f.adults), children: Number(f.children),
    rate: typed(f.rate), roomCharges: typed(f.roomCharges), gst: typed(f.gst), otherCharges: typed(f.otherCharges),
    paid: typed(f.paid), paidBy: f.paidBy || null, guestId: chosen?.id ?? null, sendBill: sendBill && !sendWhy,
  };
  const save = async () => {
    setBusy(true);
    await saved(row ? await correctBackfill(hotelId, "stays", row.id, { ...body, reason })
                    : await addBackfill(hotelId, "stays", body), onSaved);
    setBusy(false);
  };

  return (
    <FormDialog title={row ? `Correct ${row.guestName}'s stay` : "Add a stay"} busy={busy}
      ready={!!f.guestName.trim() && !!f.arrival && !!f.departure && !!f.roomId}
      onClose={onClose} onSave={() => void save()} correcting={!!row} reason={reason} setReason={setReason}>
      <Field label="Guest's name" required className="sm:col-span-2">
        {(p) => <Input {...fieldProps(p)} value={f.guestName} onChange={(e) => set("guestName")(e.target.value)} />}
      </Field>
      <Field label="Phone">
        {(p) => <Input {...fieldProps(p)} type="tel" value={f.phone} onChange={(e) => { set("phone")(e.target.value); setChosen(null); }} />}
      </Field>
      <Field label="Email" hint="Optional.">
        {(p) => <Input {...fieldProps(p)} type="email" value={f.email} onChange={(e) => { set("email")(e.target.value); setChosen(null); }} />}
      </Field>
      {!row && (
        <div className="sm:col-span-2">
          <ReturningGuest hotelId={hotelId} phone={f.phone} email={f.email} chosen={chosen} onChoose={setChosen} />
        </div>
      )}
      <Field label="Nationality" hint="Two letters: IN, GB, US...">
        {(p) => <Input {...fieldProps(p)} maxLength={2} value={f.nationality}
                       onChange={(e) => set("nationality")(e.target.value.toUpperCase())} />}
      </Field>
      <Field label="ID" required>
        {(p) => (
          <NativeSelect {...fieldProps(p)} value={foreign ? "passport" : f.idType} disabled={foreign}
            onChange={(e) => set("idType")(e.target.value)}>
            {ID_TYPES.map(([key, words]) => <option key={key} value={key}>{words}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label={foreign ? "Passport number" : "ID number"} required={!row}
        hint={row ? `Blank keeps ${row.idNumber ?? "the one on file"}.` : undefined}>
        {(p) => <Input {...fieldProps(p)} value={f.idNumber} onChange={(e) => set("idNumber")(e.target.value)} />}
      </Field>
      {foreign && (
        <>
          <Field label="Visa or OCI number" required hint="Not asked of a citizen of Nepal or Bhutan.">
            {(p) => <Input {...fieldProps(p)} value={f.visaNumber} onChange={(e) => set("visaNumber")(e.target.value)} />}
          </Field>
          <Field label="Form C reference" hint="If it was filed outside the system. Blank: Form C not recorded.">
            {(p) => <Input {...fieldProps(p)} value={f.formCReference} onChange={(e) => set("formCReference")(e.target.value)} />}
          </Field>
        </>
      )}
      <Field label="Room" required>
        {(p) => (
          <NativeSelect {...fieldProps(p)} value={f.roomId} onChange={(e) => set("roomId")(e.target.value)}>
            {v.rooms.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
          </NativeSelect>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Adults">
          {(p) => <Input {...fieldProps(p)} type="number" min={1} max={20} value={f.adults} onChange={(e) => set("adults")(e.target.value)} />}
        </Field>
        <Field label="Children">
          {(p) => <Input {...fieldProps(p)} type="number" min={0} max={20} value={f.children} onChange={(e) => set("children")(e.target.value)} />}
        </Field>
      </div>
      <Field label="Arrival" required>
        {(p) => <Input {...fieldProps(p)} type="date" max={last} value={f.arrival} onChange={(e) => set("arrival")(e.target.value)} />}
      </Field>
      <Field label="Departure" required hint={`By ${dateShort(v.firstDay)} at the latest.`}>
        {(p) => <Input {...fieldProps(p)} type="date" max={v.firstDay} value={f.departure} onChange={(e) => set("departure")(e.target.value)} />}
      </Field>
      <Money label="Rate a night" value={f.rate} set={set("rate")} />
      <Money label="Room charges" value={f.roomCharges} set={set("roomCharges")} />
      <Money label="GST" value={f.gst} set={set("gst")} />
      <Money label="Other charges" value={f.otherCharges} set={set("otherCharges")} />
      {f.otherCharges.trim() !== "" && (
        <Field label="Other charges were for" required className="sm:col-span-2">
          {(p) => <Input {...fieldProps(p)} placeholder="Laundry, minibar..." value={f.otherChargesFor}
                         onChange={(e) => set("otherChargesFor")(e.target.value)} />}
        </Field>
      )}
      <Money label="What was paid" value={f.paid} set={set("paid")} />
      <Method v={v} value={f.paidBy} set={set("paidBy")} />
      <Field label="The hotel's bill number" hint="As on the paper bill. Blank: no bill (a dash)." className="sm:col-span-2">
        {(p) => <Input {...fieldProps(p)} value={f.billNumber} onChange={(e) => set("billNumber")(e.target.value)} />}
      </Field>
      {!row && (
        <div className="sm:col-span-2 space-y-1">
          <Checkbox checked={sendBill && !sendWhy} disabled={!!sendWhy} onCheckedChange={setSendBill}
            label="Send the guest their bill and thank-you" />
          <p className="text-sm text-grey-600">
            {sendWhy ?? "By email, once, when this is saved. It quotes the hotel's bill number and is never called a tax invoice."}
          </p>
        </div>
      )}
      {row && (
        <p className="sm:col-span-2 text-sm text-grey-600">
          A correction changes this register only, and never sends the bill again. The guest's own record is corrected on Guest 360.
        </p>
      )}
    </FormDialog>
  );
}

function BillDialog({ v, hotelId, row, onClose, onSaved }: {
  v: BackfillView; hotelId: string; row: BackfillBill | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    outletId: row?.outletId ?? v.outlets[0]?.id ?? "", billDate: row?.billDate ?? "",
    billNumber: row?.billNumber ?? "", amount: shown(row?.amount ?? null), gst: shown(row?.gst ?? null),
    total: shown(row?.total ?? null), paidBy: row?.paidBy ?? "", note: row?.note ?? "",
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [key]: value }));
  const body = { ...f, amount: typed(f.amount), gst: typed(f.gst), total: typed(f.total), paidBy: f.paidBy || null };
  const save = async () => {
    setBusy(true);
    await saved(row ? await correctBackfill(hotelId, "bills", row.id, { ...body, reason })
                    : await addBackfill(hotelId, "bills", body), onSaved);
    setBusy(false);
  };
  return (
    <FormDialog title={row ? "Correct a restaurant bill" : "Add a restaurant bill"} busy={busy}
      ready={!!f.outletId && !!f.billDate} onClose={onClose} onSave={() => void save()}
      correcting={!!row} reason={reason} setReason={setReason}>
      <Field label="Restaurant" required>
        {(p) => (
          <NativeSelect {...fieldProps(p)} value={f.outletId} onChange={(e) => set("outletId")(e.target.value)}>
            {v.outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Date" required>
        {(p) => <Input {...fieldProps(p)} type="date" max={addDays(v.firstDay, -1)} value={f.billDate}
                       onChange={(e) => set("billDate")(e.target.value)} />}
      </Field>
      <Field label="The hotel's bill number" hint="Blank: no bill (a dash).">
        {(p) => <Input {...fieldProps(p)} value={f.billNumber} onChange={(e) => set("billNumber")(e.target.value)} />}
      </Field>
      <Method v={v} value={f.paidBy} set={set("paidBy")} label="How it was paid" />
      <Money label="Amount before GST" value={f.amount} set={set("amount")} />
      <Money label="GST" value={f.gst} set={set("gst")} />
      <Money label="Total" value={f.total} set={set("total")} hint="As on the bill. Blank: not recorded (a dash)." />
      <Field label="Note" className="sm:col-span-2">
        {(p) => <Input {...fieldProps(p)} maxLength={300} value={f.note} onChange={(e) => set("note")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function CashDialog({ v, hotelId, row, onClose, onSaved }: {
  v: BackfillView; hotelId: string; row: BackfillCash | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    cashDate: row?.cashDate ?? "", direction: row?.direction ?? "in", amount: row ? String(row.amount) : "",
    purpose: row?.purpose ?? "", person: row?.person ?? "",
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [key]: value }));
  const save = async () => {
    setBusy(true);
    const body = { ...f, amount: typed(f.amount) };
    await saved(row ? await correctBackfill(hotelId, "cash", row.id, { ...body, reason })
                    : await addBackfill(hotelId, "cash", body), onSaved);
    setBusy(false);
  };
  return (
    <FormDialog title={row ? "Correct a cash line" : "Add cash in or out"} busy={busy}
      ready={!!f.cashDate && !!f.amount.trim() && !!f.purpose.trim() && !!f.person.trim()}
      onClose={onClose} onSave={() => void save()} correcting={!!row} reason={reason} setReason={setReason}>
      <Field label="Date" required>
        {(p) => <Input {...fieldProps(p)} type="date" max={addDays(v.firstDay, -1)} value={f.cashDate}
                       onChange={(e) => set("cashDate")(e.target.value)} />}
      </Field>
      <Field label="Money in or out" required>
        {(p) => (
          <NativeSelect {...fieldProps(p)} value={f.direction} onChange={(e) => set("direction")(e.target.value)}>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </NativeSelect>
        )}
      </Field>
      <Money label="Amount" value={f.amount} set={set("amount")} hint="Required." />
      <Field label="What for" required>
        {(p) => <Input {...fieldProps(p)} maxLength={200} value={f.purpose} onChange={(e) => set("purpose")(e.target.value)} />}
      </Field>
      <Field label="Who" required hint="Who paid it in, or took it." className="sm:col-span-2">
        {(p) => <Input {...fieldProps(p)} maxLength={120} value={f.person} onChange={(e) => set("person")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function RemoveDialog({ what, onClose, onRemove }: {
  what: string; onClose: () => void; onRemove: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title={`Remove ${what}?`}
        description="It stays on the list, marked removed, with your reason. It no longer counts in the summary."
        footer={<>
          <Button variant="secondary" className="h-11" onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="h-11" disabled={busy || !reason.trim()}
            onClick={async () => { setBusy(true); await onRemove(reason.trim()); setBusy(false); }}>
            <Trash2 className="size-4" /> Remove
          </Button>
        </>}>
        <Field label="Why it is being removed" required>
          {(p) => <Textarea {...fieldProps(p)} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
