import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { HandCoins } from "lucide-react";
import { moneyPrecise as money, dateShort } from "@/lib/format";
import {
  Card, CardBody, Button, Skeleton, EmptyState, ErrorState, Dialog, DialogContent,
  Field, fieldProps, Input, NativeSelect, Checkbox, toast,
} from "@/components/ui";
import {
  getSupplierDues, paySupplierDue, addSupplierCreditNote, reverseSupplierEntry, suggestedDue, differenceText,
  type PayMethod, type SupplierDue, type SupplierDues as Dues, type TdsSection,
} from "@/modules/purchasing/data/purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · SUPPLIER DUES (the owner's D27-370, D27-372)

   What we owe suppliers: every bill taken on credit - on a delivery or a
   bar bill - with something left on it, each supplier with its total, and
   the total owed. A bill past its due date is in red. A payment pays all or
   part of what is left: how, its reference (required unless cash), its date,
   who handed the money over, and the TDS when the Accountant deducted it. A
   credit note, money only, lowers a bill or the supplier. A mistake is
   reversed with a reason; both stay on the record. No cash drawer is
   touched. Seen and used by the Accountant, the GM, the owner and an Admin.
   ══════════════════════════════════════════════════════════════════ */

const METHODS: { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" },
  { value: "bank", label: "Bank transfer" }, { value: "upi", label: "UPI" },
];
const SECTIONS: TdsSection[] = ["194C", "194Q", "194J", "194I"];
const round = (n: number) => Math.round(n * 100) / 100;
type Reversing = { kind: "bill" | "payment" | "credit-note"; id: string; what: string };

export function SupplierDues({ hotelId }: { hotelId: string }) {
  const q = useQuery({ queryKey: ["supplier-dues", hotelId], queryFn: () => getSupplierDues(hotelId) });
  const [paying, setPaying] = useState<SupplierDue | null>(null);
  const [crediting, setCrediting] = useState<{ bill: SupplierDue | null; supplierId: string; supplier: string } | null>(null);
  const [reversing, setReversing] = useState<Reversing | null>(null);

  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState title="The supplier dues did not load" onRetry={() => void q.refetch()} />;

  const { today, bills, credits } = q.data;
  if (bills.length === 0 && credits.length === 0) {
    return (
      <EmptyState icon={<HandCoins />} title="Nothing is owed to a supplier"
        description="A delivery or a bar bill recorded on credit is listed here until it is paid." />
    );
  }

  /* By supplier: its bills, and its credit notes not against one bill. */
  const groups = new Map<string, { supplierId: string | null; name: string; bills: SupplierDue[]; credits: Dues["credits"] }>();
  const group = (key: string, supplierId: string | null, name: string) =>
    groups.get(key) ?? groups.set(key, { supplierId, name, bills: [], credits: [] }).get(key)!;
  for (const b of bills) group(b.supplierId ?? b.supplier.trim().toLowerCase(), b.supplierId, b.supplier).bills.push(b);
  for (const n of credits) group(n.supplierId, n.supplierId, n.supplier).credits.push(n);
  const owedOf = (g: { bills: SupplierDue[]; credits: Dues["credits"] }) =>
    round(g.bills.reduce((s, b) => s + Number(b.owed), 0) - g.credits.reduce((s, n) => s + Number(n.amount), 0));
  const total = round([...groups.values()].reduce((s, g) => s + owedOf(g), 0));

  return (
    <div className="space-y-4">
      <p className="text-base text-ink-900" data-dues-total>
        Owed to suppliers: <span className="font-semibold tabular">{money(total)}</span>
        <span className="text-grey-600"> · {bills.length} bill{bills.length === 1 ? "" : "s"}</span>
      </p>
      {[...groups.values()].map((g) => (
        <Card key={g.supplierId ?? g.name} className="overflow-x-auto">
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-base font-semibold text-ink-900 flex-1 min-w-0">{g.name}</p>
              {g.supplierId && (
                <>
                  <Link className="text-sm underline" to={`/reports/supplier-statement?supplier=${g.supplierId}`}>Statement</Link>
                  <Button size="sm" variant="ghost"
                    onClick={() => setCrediting({ bill: null, supplierId: g.supplierId!, supplier: g.name })}>
                    Credit note
                  </Button>
                </>
              )}
              <span className="text-base font-medium tabular text-ink-900" data-supplier-total>{money(owedOf(g))}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-grey-200 text-2xs font-semibold uppercase tracking-[0.025em] text-grey-500 whitespace-nowrap">
                <tr>
                  <th className="h-9 text-left">Bill</th>
                  <th className="h-9 text-left">Bill date</th>
                  <th className="h-9 text-left">Due</th>
                  <th className="h-9 text-right">Amount</th>
                  <th className="h-9 text-right">Left</th>
                  <th className="h-9" />
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {g.bills.map((b) => {
                  const overdue = b.dueOn < today;
                  const entries = [
                    ...b.payments.map((p) => ({
                      key: p.id, reversed: p.reversed, rev: { kind: "payment" as const, id: p.id, what: `the payment of ${money(Number(p.amount))}` },
                      text: `Paid ${money(Number(p.amount))} on ${dateShort(p.paidOn)} by ${METHODS.find((m) => m.value === p.method)?.label ?? p.method}`
                        + (p.reference ? ` (${p.reference})` : "")
                        + (p.tds ? ` · TDS ${p.tds.section} ${p.tds.rate}%: ${money(Number(p.tds.amount))}` : "")
                        + (p.handedOverBy ? ` · handed over by ${p.handedOverBy}` : "")
                        + (p.differencesSeenBy ? ` · differences from the order seen by ${p.differencesSeenBy}` : ""),
                    })),
                    ...b.creditNotes.map((n) => ({
                      key: n.id, reversed: false, rev: { kind: "credit-note" as const, id: n.id, what: `credit note ${n.noteNo}` },
                      text: `Credit note ${n.noteNo} of ${dateShort(n.noteDate)}: ${money(Number(n.amount))} - ${n.reason}`,
                    })),
                  ];
                  return [
                    <tr key={b.id} data-bill={b.billNo}>
                      <td className="py-2">
                        {b.billNo}
                        <span className="text-grey-500">
                          {" · "}
                          {b.from.kind === "bar" ? "bar bill"
                            : <Link className="underline" to={`/h/${hotelId}/purchasing/${b.from.id}`}>{b.from.reference}</Link>}
                          {b.replaces ? ` · replaces ${b.replaces}` : ""}
                        </span>
                        {/* THE BILL AGAINST ITS ORDER (D27-383 item 11). */}
                        {b.differences.length > 0 && (
                          <span className="block text-xs font-medium text-brand-red-700" data-bill-differs="">
                            Differs from the order: {b.differences.map(differenceText).join("; ")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 tabular">{dateShort(b.billDate)}</td>
                      <td className={overdue ? "py-2 tabular text-brand-red-700 font-medium" : "py-2 tabular"}
                        data-overdue={overdue || undefined}>
                        {dateShort(b.dueOn)}{overdue ? " · overdue" : ""}
                      </td>
                      <td className="py-2 text-right tabular">{money(Number(b.amount))}</td>
                      <td className="py-2 text-right tabular" data-left>
                        {money(Number(b.owed))}
                        {b.status === "part-paid" && <span className="block text-2xs text-grey-500">Part-paid</span>}
                      </td>
                      <td className="py-2 pl-3 text-right whitespace-nowrap space-x-1">
                        <Button size="sm" variant="secondary" onClick={() => setPaying(b)}>Record payment</Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setCrediting({ bill: b, supplierId: b.supplierId ?? "", supplier: b.supplier })}>
                          Credit note
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setReversing({ kind: "bill", id: b.id, what: `bill ${b.billNo}` })}>Reverse</Button>
                      </td>
                    </tr>,
                    ...entries.map((e) => (
                      <tr key={e.key} className="text-grey-600">
                        <td colSpan={5} className={e.reversed ? "py-1 pl-4 line-through" : "py-1 pl-4"}>{e.text}</td>
                        <td className="py-1 text-right">
                          {!e.reversed && (
                            <Button size="sm" variant="ghost" onClick={() => setReversing(e.rev)}>Reverse</Button>
                          )}
                        </td>
                      </tr>
                    )),
                  ];
                })}
                {g.credits.map((n) => (
                  <tr key={n.id} className="text-grey-600">
                    <td colSpan={5} className="py-1">
                      Credit note {n.noteNo} of {dateShort(n.noteDate)}: {money(Number(n.amount))} - {n.reason}
                    </td>
                    <td className="py-1 text-right">
                      <Button size="sm" variant="ghost"
                        onClick={() => setReversing({ kind: "credit-note", id: n.id, what: `credit note ${n.noteNo}` })}>Reverse</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ))}
      {paying && <PayDialog hotelId={hotelId} bill={paying} today={today} onClose={() => setPaying(null)} />}
      {crediting && <CreditDialog hotelId={hotelId} {...crediting} today={today} onClose={() => setCrediting(null)} />}
      {reversing && <ReverseDialog hotelId={hotelId} entry={reversing} onClose={() => setReversing(null)} />}
    </div>
  );
}

function useRefresh(hotelId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["supplier-dues", hotelId] });
    void qc.invalidateQueries({ queryKey: ["bar-bills", hotelId] });
    void qc.invalidateQueries({ queryKey: ["purchasing", "request", hotelId] });
  };
}

function PayDialog({ hotelId, bill, today, onClose }: {
  hotelId: string; bill: SupplierDue; today: string; onClose: () => void;
}) {
  const refresh = useRefresh(hotelId);
  const [amount, setAmount] = useState(bill.owed);
  const [method, setMethod] = useState<PayMethod | "">("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [handedOverBy, setHandedOverBy] = useState("");
  const [withTds, setWithTds] = useState(false);
  const [section, setSection] = useState<TdsSection | "">("");
  const [rate, setRate] = useState("");
  const [tdsAmount, setTdsAmount] = useState("");
  /* D27-383 item 11: a bill that differs from its order is paid only by
     somebody who says they have seen how; the server keeps their name. */
  const differs = bill.differences.length > 0;
  const [seen, setSeen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (differs && !seen) return setProblem("Tick that you have seen how this bill differs from its order, then record the payment.");
    if (!(Number(amount) > 0)) return setProblem("Type the amount paid to the supplier: more than zero.");
    if (!method) return setProblem("How was it paid? Cash, cheque, bank or UPI.");
    if (method !== "cash" && !reference.trim()) return setProblem("Type the cheque, UTR or UPI reference.");
    if (!paidOn) return setProblem("Pick the date it was paid.");
    if (withTds && (!section || !(Number(rate) > 0) || !(Number(tdsAmount) > 0))) {
      return setProblem("TDS is its section, rate and amount: all three.");
    }
    setSaving(true);
    const out = await paySupplierDue(hotelId, bill.id, {
      amount: Number(amount), method, reference: reference.trim() || null, paidOn, handedOverBy: handedOverBy.trim(),
      tds: withTds ? { section: section as TdsSection, rate: Number(rate), amount: Number(tdsAmount) } : null,
      ...(differs ? { differencesSeen: seen } : {}),
    });
    setSaving(false);
    if (!out.ok) return setProblem(out.reason);
    refresh();
    onClose();
    toast.success(`Payment recorded on bill ${bill.billNo}`, `${money(Number(amount))} to ${bill.supplier}.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={`Pay bill ${bill.billNo}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>Record payment</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            {bill.supplier}: {money(Number(bill.owed))} left of {money(Number(bill.amount))}. Pay all of it or a part.
            Nothing changes in a cash drawer.
          </p>
          {differs && (
            <div className="rounded-lg bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 px-4 py-3 space-y-2"
                 data-pay-differences="">
              <p className="text-sm font-semibold text-ink-900">This bill differs from its order</p>
              <ul className="text-sm text-ink-900 space-y-0.5 tabular">
                {bill.differences.map((d) => <li key={`${d.lineId}-${d.kind}`}>{differenceText(d)}</li>)}
              </ul>
              <Checkbox checked={seen} onCheckedChange={setSeen}
                label="I have seen these differences, and this bill is to be paid as it is" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount paid">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <Field label="How">
              {(p) => (
                <NativeSelect {...fieldProps(p)} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                  <option value="">Pick one</option>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Reference" hint={method === "cash" ? "Optional for cash." : "Cheque, UTR or UPI number."}>
              {(p) => <Input {...fieldProps(p)} value={reference} onChange={(e) => setReference(e.target.value)} />}
            </Field>
            <Field label="Paid on">
              {(p) => <Input {...fieldProps(p)} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
            </Field>
            <Field label="Handed over by" hint="Who gave the supplier the money or cheque." className="sm:col-span-2">
              {(p) => <Input {...fieldProps(p)} value={handedOverBy} onChange={(e) => setHandedOverBy(e.target.value)} />}
            </Field>
          </div>
          <Checkbox checked={withTds} onCheckedChange={setWithTds} label="TDS deducted" />
          {withTds && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Section">
                {(p) => (
                  <NativeSelect {...fieldProps(p)} value={section} onChange={(e) => setSection(e.target.value as TdsSection)}>
                    <option value="">Pick one</option>
                    {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Rate, %">
                {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}
              </Field>
              <Field label="TDS amount">
                {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} />}
              </Field>
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ hotelId, bill, supplierId, supplier, today, onClose }: {
  hotelId: string; bill: SupplierDue | null; supplierId: string; supplier: string; today: string; onClose: () => void;
}) {
  const refresh = useRefresh(hotelId);
  const [issuedBy, setIssuedBy] = useState<"supplier" | "hotel">("supplier");
  const [noteNo, setNoteNo] = useState("");
  const [noteDate, setNoteDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!noteNo.trim()) return setProblem("Type the credit note's number.");
    if (!(Number(amount) > 0)) return setProblem("Type the credit note's amount: more than zero.");
    if (!reason.trim()) return setProblem("Say what it is for: goods returned, a short supply, a price corrected.");
    setSaving(true);
    const out = await addSupplierCreditNote(hotelId, {
      billId: bill?.id ?? null, supplierId: bill ? null : supplierId, issuedBy,
      noteNo: noteNo.trim(), noteDate, amount: Number(amount), reason: reason.trim(),
    });
    setSaving(false);
    if (!out.ok) return setProblem(out.reason);
    refresh();
    onClose();
    toast.success(`Credit note ${noteNo.trim()} recorded`, `${money(Number(amount))} off what is owed to ${supplier}.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={bill ? `Credit note on bill ${bill.billNo}` : `Credit note from ${supplier}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>Record credit note</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            Money only: it lowers what is owed. Goods sent back leave the store as a store movement, separately.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Whose note">
              {(p) => (
                <NativeSelect {...fieldProps(p)} value={issuedBy} onChange={(e) => setIssuedBy(e.target.value as "supplier" | "hotel")}>
                  <option value="supplier">The supplier's</option>
                  <option value="hotel">Ours (a debit note to the supplier)</option>
                </NativeSelect>
              )}
            </Field>
            <Field label="Number">
              {(p) => <Input {...fieldProps(p)} value={noteNo} onChange={(e) => setNoteNo(e.target.value)} />}
            </Field>
            <Field label="Date">
              {(p) => <Input {...fieldProps(p)} type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />}
            </Field>
            <Field label="Amount">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <Field label="What it is for" className="sm:col-span-2">
              {(p) => <Input {...fieldProps(p)} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ hotelId, entry, onClose }: { hotelId: string; entry: Reversing; onClose: () => void }) {
  const refresh = useRefresh(hotelId);
  const [reason, setReason] = useState("");
  /* A wrong bill may be followed by its right one (D27-372): optional. */
  const [right, setRight] = useState({ billNo: "", billDate: "", amount: "", dueOn: "" });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!reason.trim()) return setProblem("Say why it is reversed.");
    const correct = entry.kind === "bill" && right.billNo.trim()
      ? { billNo: right.billNo.trim(), billDate: right.billDate, amount: Number(right.amount), dueOn: right.dueOn }
      : null;
    if (correct && (!correct.billDate || !(correct.amount > 0) || !correct.dueOn)) {
      return setProblem("The right bill needs its number, date, amount and due date - or leave its number empty.");
    }
    setSaving(true);
    const out = await reverseSupplierEntry(hotelId, { kind: entry.kind, id: entry.id, reason: reason.trim(), correct });
    setSaving(false);
    if (!out.ok) return setProblem(out.reason);
    refresh();
    onClose();
    toast.success(`Reversed ${entry.what}`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={`Reverse ${entry.what}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" loading={saving} onClick={() => void submit()}>Reverse</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            Nothing is deleted: the entry and its reversal both stay on the record, with your reason and your name.
          </p>
          <Field label="Why">
            {(p) => <Input {...fieldProps(p)} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          {entry.kind === "bill" && (
            <div className="space-y-2">
              <p className="text-sm text-grey-600">The right bill, if there is one (leave its number empty if not):</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Bill number">
                  {(p) => <Input {...fieldProps(p)} value={right.billNo} onChange={(e) => setRight((r) => ({ ...r, billNo: e.target.value }))} />}
                </Field>
                <Field label="Bill date">
                  {(p) => <Input {...fieldProps(p)} type="date" value={right.billDate}
                    onChange={(e) => setRight((r) => ({ ...r, billDate: e.target.value, dueOn: r.dueOn || suggestedDue(e.target.value) }))} />}
                </Field>
                <Field label="Amount">
                  {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={right.amount} onChange={(e) => setRight((r) => ({ ...r, amount: e.target.value }))} />}
                </Field>
                <Field label="Due on">
                  {(p) => <Input {...fieldProps(p)} type="date" value={right.dueOn} onChange={(e) => setRight((r) => ({ ...r, dueOn: e.target.value }))} />}
                </Field>
              </div>
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
