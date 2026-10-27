import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { HandCoins } from "lucide-react";
import { moneyPrecise as money, dateShort } from "@/lib/format";
import {
  Card, CardBody, Button, Skeleton, EmptyState, ErrorState, Dialog, DialogContent,
  Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import {
  getSupplierDues, paySupplierDue, type PayMethod, type SupplierDue,
} from "@/modules/purchasing/data/purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · SUPPLIER DUES (the owner's D27-370, 27 October)

   What we owe suppliers: every bill taken on credit - on a delivery or a
   bar bill - and not yet paid, each supplier with its total, and the total
   owed. A bill past its due date is in red. Record a payment: how (cash,
   cheque, bank, UPI), its reference and its date; the bill is paid in full
   and leaves this list. No cash drawer is touched. Seen and paid by the
   accountant, the GM, the owner and an administrator.
   ══════════════════════════════════════════════════════════════════ */

const METHODS: { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" },
  { value: "bank", label: "Bank transfer" }, { value: "upi", label: "UPI" },
];

const sum = (bills: SupplierDue[]) => Math.round(bills.reduce((s, b) => s + Number(b.amount), 0) * 100) / 100;

export function SupplierDues({ hotelId }: { hotelId: string }) {
  const q = useQuery({ queryKey: ["supplier-dues", hotelId], queryFn: () => getSupplierDues(hotelId) });
  const [paying, setPaying] = useState<SupplierDue | null>(null);

  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState title="The supplier dues did not load" onRetry={() => void q.refetch()} />;

  const { today, bills } = q.data;
  if (bills.length === 0) {
    return (
      <EmptyState icon={<HandCoins />} title="Nothing is owed to a supplier"
        description="A delivery or a bar bill recorded on credit is listed here until it is paid." />
    );
  }

  const suppliers = [...bills.reduce((m, b) => {
    const key = b.supplier.trim().toLowerCase();
    return m.set(key, [...(m.get(key) ?? []), b]);
  }, new Map<string, SupplierDue[]>()).values()];

  return (
    <div className="space-y-4">
      <p className="text-base text-ink-900" data-dues-total>
        Owed to suppliers: <span className="font-semibold tabular">{money(sum(bills))}</span>
        <span className="text-grey-600"> · {bills.length} bill{bills.length === 1 ? "" : "s"}</span>
      </p>
      {suppliers.map((list) => (
        <Card key={list[0]!.supplier} className="overflow-x-auto">
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="text-base font-semibold text-ink-900 flex-1 min-w-0">{list[0]!.supplier}</p>
              <span className="text-base font-medium tabular text-ink-900" data-supplier-total>{money(sum(list))}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-grey-200 text-2xs font-semibold uppercase tracking-[0.025em] text-grey-500 whitespace-nowrap">
                <tr>
                  <th className="h-9 text-left">Bill</th>
                  <th className="h-9 text-left">Bill date</th>
                  <th className="h-9 text-left">Due</th>
                  <th className="h-9 text-right">Amount</th>
                  <th className="h-9" />
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-100">
                {list.map((b) => {
                  const overdue = b.dueOn < today;
                  return (
                    <tr key={b.id} data-bill={b.billNo}>
                      <td className="py-2">
                        {b.billNo}
                        <span className="text-grey-500">
                          {" · "}
                          {b.from.kind === "bar" ? "bar bill"
                            : <Link className="underline" to={`/h/${hotelId}/purchasing/${b.from.id}`}>{b.from.reference}</Link>}
                        </span>
                      </td>
                      <td className="py-2 tabular">{dateShort(b.billDate)}</td>
                      <td className={overdue ? "py-2 tabular text-brand-red-700 font-medium" : "py-2 tabular"}
                        data-overdue={overdue || undefined}>
                        {dateShort(b.dueOn)}{overdue ? " · overdue" : ""}
                      </td>
                      <td className="py-2 text-right tabular">{money(Number(b.amount))}</td>
                      <td className="py-2 pl-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => setPaying(b)}>Record payment</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ))}
      {paying && <PayDialog hotelId={hotelId} bill={paying} today={today} onClose={() => setPaying(null)} />}
    </div>
  );
}

function PayDialog({ hotelId, bill, today, onClose }: {
  hotelId: string; bill: SupplierDue; today: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PayMethod | "">("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!method) return setProblem("How was it paid? Cash, cheque, bank or UPI.");
    if (!paidOn) return setProblem("Pick the date it was paid.");
    setSaving(true);
    const out = await paySupplierDue(hotelId, bill.id, { method, reference: reference.trim() || null, paidOn });
    setSaving(false);
    if (!out.ok) return setProblem(out.reason);
    void qc.invalidateQueries({ queryKey: ["supplier-dues", hotelId] });
    void qc.invalidateQueries({ queryKey: ["bar-bills", hotelId] });
    void qc.invalidateQueries({ queryKey: ["purchasing", "request", hotelId] });
    onClose();
    toast.success(`Bill ${bill.billNo} marked paid`, `${money(Number(bill.amount))} to ${bill.supplier}.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={`Pay bill ${bill.billNo}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>Mark paid</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            {bill.supplier}: {money(Number(bill.amount))}, paid in full. Nothing changes in a cash drawer.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="How">
              {(p) => (
                <NativeSelect {...fieldProps(p)} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                  <option value="">Pick one</option>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Reference" hint="Cheque or UTR number. Optional.">
              {(p) => <Input {...fieldProps(p)} value={reference} onChange={(e) => setReference(e.target.value)} />}
            </Field>
            <Field label="Paid on">
              {(p) => <Input {...fieldProps(p)} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
            </Field>
          </div>
          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
