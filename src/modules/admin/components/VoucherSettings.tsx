import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Card, CardBody, Dialog, DialogContent, Field, fieldProps, Input, Textarea,
  ReadFailed, Skeleton, toast,
} from "@/components/ui";
import { dateTime } from "@/lib/format";
import {
  amendProperty, getBankDetails, setBankDetails, removeBankDetails, type BankDetails,
} from "@/modules/admin/data/admin";
import { SettingHeader, SettingRow, SettingValues } from "@/modules/admin/pages/Admin";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE BOOKING VOUCHER PRINTS, SET HERE (the owner's D27-215)

   A hotel's BANK DETAILS (Settings › Taxes and billing): printed on the
   voucher when set, the block left out when not. Seen and changed by the
   hotel's owner, GM and Admin - the people who open Settings. Every
   change is told to the group owner's bell (D27-216), and the card says
   so, before it is pressed.

   A hotel's HOUSE POLICIES (Settings › Reservations and front desk): a
   short list, printed after the booking's own cancellation terms. Edited
   as lines of text - retype, add, remove or move a line; that is the
   whole editor. Eight of 200 characters at most: the voucher is one page.

   The server says what is wrong with a field, in a sentence; this shows it.
   ══════════════════════════════════════════════════════════════════ */

const BLANK = { accountName: "", accountNumber: "", bankName: "", branch: "", ifsc: "", upi: "" };

export function BankDetailsCard({ hotelCode }: { hotelCode: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["bank-details", hotelCode],
    queryFn: () => getBankDetails(hotelCode),
    enabled: Boolean(hotelCode),
  });
  const bank = q.data ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["bank-details", hotelCode] });

  return (
    <Card>
      <SettingHeader
        title="Bank details"
        line="The group's owner is told whenever they change."
        info="Printed on this hotel's booking voucher. With none set, the voucher prints no bank details."
        actions={!q.isLoading && !q.isError && (
          <Button variant="secondary" onClick={() => setEditing(true)}>{bank ? "Change" : "Set bank details"}</Button>
        )}
      />
      <CardBody>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.isError ? (
          <ReadFailed compact error={q.error} what="the bank details" onRetry={() => void q.refetch()} />
        ) : !bank ? (
          <p className="text-base text-grey-500">None set.</p>
        ) : (
          <>
            <SettingValues>
              <SettingRow wide label="Account name" value={bank.accountName} />
              <SettingRow wide label="Account no." value={bank.accountNumber} />
              <SettingRow wide label="Bank" value={bank.bankName} />
              <SettingRow wide label="Branch" value={bank.branch ?? "-"} />
              <SettingRow label="IFSC" value={bank.ifsc} />
              <SettingRow label="UPI ID" value={bank.upi ?? "-"} />
            </SettingValues>
            <p className="text-xs font-medium text-grey-500 mt-3">
              Last changed{bank.changedBy ? ` by ${bank.changedBy}` : ""} on {dateTime(bank.changedAt)}.
            </p>
          </>
        )}
      </CardBody>
      {editing && (
        <BankDetailsDialog hotelCode={hotelCode} bank={bank}
          onClose={() => setEditing(false)} onSaved={refresh} />
      )}
    </Card>
  );
}

function BankDetailsDialog({ hotelCode, bank, onClose, onSaved }: {
  hotelCode: string; bank: BankDetails | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState(bank
    ? { accountName: bank.accountName, accountNumber: bank.accountNumber, bankName: bank.bankName,
        branch: bank.branch ?? "", ifsc: bank.ifsc, upi: bank.upi ?? "" }
    : BLANK);
  const [busy, setBusy] = useState(false);
  const put = (key: keyof typeof BLANK, upper = false) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: upper ? e.target.value.toUpperCase() : e.target.value }));

  const save = async () => {
    setBusy(true);
    const res = await setBankDetails(hotelCode, form);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Bank details saved", "They print on this hotel's booking vouchers from now on.");
    onSaved();
    onClose();
  };
  const remove = async () => {
    setBusy(true);
    const res = await removeBankDetails(hotelCode);
    setBusy(false);
    if (!res.ok) return toast.error("Not removed", res.reason);
    toast.success("Bank details removed", "The voucher prints no bank details.");
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Bank details"
        description="As they should print on the booking voucher. The group's owner is told of this change."
        footer={
          <>
            {bank && <Button variant="ghost" size="lg" disabled={busy} onClick={() => void remove()}>Remove</Button>}
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Account name" required hint="The name the account is in.">
            {(f) => <Input {...fieldProps(f)} value={form.accountName} autoFocus maxLength={100} onChange={put("accountName")} />}
          </Field>
          <Field label="Account number" required hint="Digits only, 9 to 18 of them.">
            {(f) => (
              <Input {...fieldProps(f)} value={form.accountNumber} inputMode="numeric" className="tabular"
                     onChange={put("accountNumber")} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank" required>
              {(f) => <Input {...fieldProps(f)} value={form.bankName} maxLength={100} onChange={put("bankName")} />}
            </Field>
            <Field label="Branch">
              {(f) => <Input {...fieldProps(f)} value={form.branch} maxLength={100} onChange={put("branch")} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="IFSC" required hint="Eleven characters, the fifth a zero.">
              {(f) => (
                <Input {...fieldProps(f)} value={form.ifsc} maxLength={11} className="tabular"
                       onChange={put("ifsc", true)} />
              )}
            </Field>
            <Field label="UPI ID" hint="If guests may pay to one: name@bank.">
              {(f) => <Input {...fieldProps(f)} value={form.upi} onChange={put("upi")} />}
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── House policies ───────────────────────────────────────────────── */

export function HousePoliciesCard({ hotelCode, policies, onSaved }: {
  hotelCode: string; policies: string[]; onSaved: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await amendProperty(hotelCode, { housePolicies: (typed ?? "").split("\n") });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("House policies saved", "They print on this hotel's booking vouchers from now on.");
    setTyped(null);
    onSaved();
  };

  return (
    <Card>
      <SettingHeader
        title="House policies"
        line="Printed on this hotel's booking voucher."
        info="After the booking's own cancellation terms and the check-in and check-out times."
        actions={<Button variant="secondary" onClick={() => setTyped(policies.join("\n"))}>Edit</Button>}
      />
      <CardBody>
        {policies.length === 0 ? (
          <p className="text-base text-grey-500">None. The voucher prints the booking's terms and the times only.</p>
        ) : (
          <ol className="list-decimal pl-5 space-y-2 text-base text-ink-900">
            {policies.map((line, i) => <li key={i} className="break-words">{line}</li>)}
          </ol>
        )}
      </CardBody>
      {typed !== null && (
        <Dialog open onOpenChange={(o) => !o && setTyped(null)}>
          <DialogContent
            title="House policies"
            description="One policy a line, in the order they print."
            footer={
              <>
                <Button variant="secondary" size="lg" onClick={() => setTyped(null)}>Cancel</Button>
                <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>Save</Button>
              </>
            }
          >
            <Field label="Policies"
                   hint="At most 8, each up to 200 characters. Move a line to change the order; empty the box for none.">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={10} value={typed} autoFocus
                          onChange={(e) => setTyped(e.target.value)} />
              )}
            </Field>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
