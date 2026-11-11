import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Undo2 } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateShort, dateTime } from "@/lib/format";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Input, NativeSelect, Field, Segmented, Checkbox,
  fieldProps, StatusPill, DataTable, type Column, Dialog, DialogContent, Skeleton, ErrorState, EmptyState, toast,
} from "@/components/ui";
import {
  getImports, sendImport, undoImport,
  type ImportKind, type ImportCheck, type ImportChoice, type ImportRecord, type ImportRow,
} from "@/modules/admin/data/oldSystem";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → BRING IN OLD DATA (D27-383 item 7, built under D27-396)

   A hotel coming from another system (IDS, WinHMS, eZee, a spreadsheet)
   brings its guests, its bookings to come and its past stays, from an
   Excel or CSV file:

     1  choose the kind of file, name the old system, choose the file
     2  match its columns (kept for the hotel's next file), and see every
        row: what it becomes, or why not. A fault in the file saves nothing;
        a guest already on file waits for keep, merge or skip
     3  Bring in: one transaction. Then it is in the list below, with who,
        when, the file, rows in and rows refused, and Undo while nothing has
        touched what it brought in

   Bookings to come are ordinary confirmed bookings, never overbooked; one
   with no rate comes in with a dash and is listed below until the desk
   sets it. Past stays are history only. The owner and an Admin (the
   server's own answer, `may`).
   ══════════════════════════════════════════════════════════════════ */

const KIND_WORDS: Record<ImportKind, string> = { guests: "Guests", bookings: "Bookings and past stays" };

const RESULT: Record<string, { tone: "success" | "neutral" | "warning" | "danger" | "info"; word: string }> = {
  new: { tone: "success", word: "New guest" },
  duplicate: { tone: "warning", word: "Already on file" },
  merge: { tone: "info", word: "Merge" },
  skip: { tone: "neutral", word: "Skip" },
  booking: { tone: "success", word: "Booking" },
  stay: { tone: "info", word: "Past stay" },
  refused: { tone: "danger", word: "Refused" },
};

export default function OldDataPage() {
  const hotelId = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["imports", hotelId], queryFn: () => getImports(hotelId), enabled: !!hotelId });

  const [kind, setKind] = useState<ImportKind>("guests");
  const [system, setSystem] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  /** The columns or a choice changed since the last check. */
  const [stale, setStale] = useState(false);
  /* "Send each guest our booking voucher": off unless ticked (the master,
     under D27-396) - the old system confirmed these bookings already. */
  const [sendVouchers, setSendVouchers] = useState(false);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [undoing, setUndoing] = useState<ImportRecord | null>(null);
  const [refusedOf, setRefusedOf] = useState<ImportRecord | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const header = (
    <PageHeader title="Bring in old data"
      description="An old system's guests, its bookings to come and its past stays, from an Excel or CSV file." />
  );
  if (view.isLoading) return <Page>{header}<Skeleton className="h-80" /></Page>;
  if (view.error || !view.data) {
    return <Page>{header}<Card><ErrorState error={view.error} onRetry={() => void view.refetch()} /></Card></Page>;
  }
  const v = view.data;
  if (!v.may) {
    return <Page>{header}<Card><CardBody className="text-base">{v.reason}</CardBody></Card></Page>;
  }
  const lastSystem = v.imports?.[0]?.system ?? "";
  const systemName = system || lastSystem;

  const reset = () => {
    setFile(null); setCheck(null); setProblem(null); setColumns({}); setChoices({}); setStale(false);
  };

  const ask = async (f: File, save: boolean, cols?: Record<string, string>) => {
    if (!systemName.trim()) { setProblem("Say which system the file came from first (IDS, eZee, a spreadsheet)."); return; }
    setBusy(save ? "save" : "check"); setProblem(null);
    const out = await sendImport(hotelId,
      { kind, file: f, system: systemName.trim(), columns: cols, choices, sendVouchers }, save);
    setBusy(null);
    if (save && out.ok) {
      const c = out.counts;
      toast.success("Brought in", c
        ? [c.new && many(c.new, "new guest"), c.merge && `${c.merge} merged`, c.bookings && many(c.bookings, "booking"),
           c.stays && many(c.stays, "past stay"), c.refused + c.skip && `${c.refused + c.skip} not brought in, listed`]
            .filter(Boolean).join(", ")
        : undefined);
      reset();
      setSendVouchers(false);
      void qc.invalidateQueries();
      return;
    }
    if (!out.headers) { setProblem(out.reason ?? "That file could not be read."); setCheck(null); return; }
    setCheck(out as ImportCheck);
    setColumns(out.columns ?? {});
    setStale(false);
    if (out.reason) setProblem(out.reason);
  };

  const choose = (f: File) => { reset(); setFile(f); void ask(f, false); };
  const dupes = check?.rows.filter((r) => r.matches) ?? [];
  const everyDupe = (c: (r: ImportRow) => ImportChoice) => {
    setChoices((now) => ({ ...now, ...Object.fromEntries(dupes.map((r) => [String(r.line), c(r)])) }));
    setStale(true);
  };
  const counts = check?.counts;
  const saving = counts ? counts.new + counts.merge + counts.bookings + counts.stays : 0;
  const saveBlocked = !check || !check.ok ? "Correct what the check lists first."
    : stale ? "Check again: the columns or a choice changed."
    : saving === 0 ? "Nothing in this file would be brought in." : null;

  const rowColumns: Column<ImportRow>[] = [
    { key: "line", header: "Row", width: "w-[64px]", cell: (r) => <span className="tabular">{r.line}</span> },
    { key: "name", header: "Guest", cell: (r) => <span className="font-medium">{r.name || "-"}</span> },
    { key: "what", header: "What", hideBelow: "md", cell: (r) => <span className="text-grey-600">{r.what}</span> },
    { key: "result", header: "Becomes", cell: (r) => {
      const res = r.problems.length && r.action !== "duplicate" ? { tone: "danger" as const, word: "Fault in the file" } : RESULT[r.action];
      return <StatusPill tone={res?.tone ?? "neutral"}>{res?.word ?? r.action}</StatusPill>;
    } },
    { key: "detail", header: "Details", cell: (r) => (
      <div className="space-y-1 text-sm">
        {r.matches && (
          <NativeSelect aria-label={`Row ${r.line}: keep, merge or skip`} className="max-w-[18rem]"
            value={choiceValue(choices[String(r.line)])}
            onChange={(e) => {
              const pick = e.target.value;
              setChoices((now) => {
                const { [String(r.line)]: _gone, ...rest } = now;
                return pick ? { ...rest, [String(r.line)]: choiceOf(pick) } : rest;
              });
              setStale(true);
            }}>
            <option value="">Choose…</option>
            <option value="keep">Keep: a new guest record</option>
            {r.matches.map((m) => (
              <option key={m.id} value={`merge:${m.id}`}>
                Merge with {m.name}{m.visits ? ` (${m.visits} ${m.visits === 1 ? "visit" : "visits"})` : ""}
              </option>
            ))}
            <option value="skip">Skip this row</option>
          </NativeSelect>
        )}
        {r.problems.filter((p) => !(r.matches && p.startsWith("Already on file"))).map((p, i) => (
          <p key={`p${i}`} className="text-brand-red-700">{p}</p>
        ))}
        {r.refused && <p className="text-brand-red-700">{r.refused}</p>}
        {r.notes.map((n, i) => <p key={`n${i}`} className="text-grey-600">{n}</p>)}
      </div>
    ) },
  ];

  const historyColumns: Column<ImportRecord>[] = [
    { key: "when", header: "When", cell: (d) => <span className="tabular">{dateTime(d.madeAt)}</span> },
    { key: "file", header: "File", cell: (d) => (
      <div><p className="font-medium">{d.fileName}</p><p className="text-sm text-grey-600">{KIND_WORDS[d.kind]} from {d.system}</p></div>
    ) },
    { key: "who", header: "By", hideBelow: "md", cell: (d) => d.madeBy ?? "-" },
    { key: "voucher", header: "Vouchers", hideBelow: "lg", cell: (d) => d.kind === "guests" ? "-" : d.sendVouchers ? "Sent" : "Not sent" },
    { key: "in", header: "Rows in", numeric: true, cell: (d) => <span className="tabular">{d.rowsIn}</span> },
    { key: "refused", header: "Refused", numeric: true, cell: (d) => d.rowsRefused === 0
      ? <span className="tabular">0</span>
      : <Button variant="link" aria-label={`${d.rowsRefused} rows refused: see them`} onClick={() => setRefusedOf(d)}>{d.rowsRefused}</Button> },
    { key: "brought", header: "Brought in", hideBelow: "lg", cell: (d) => (
      <span className="text-sm">{[d.guests && many(d.guests, "guest"), d.filled && `${d.filled} filled in`,
        d.bookings && many(d.bookings, "booking"), d.stays && many(d.stays, "past stay"),
        d.advances && many(d.advances, "advance")].filter(Boolean).join(", ") || "-"}</span>
    ) },
    { key: "state", header: "", cell: (d) => d.undoneAt
      ? <span className="text-sm text-grey-600">Undone {dateShort(d.undoneAt)}{d.undoneBy ? ` by ${d.undoneBy}` : ""}</span>
      : <Button size="sm" leadingIcon={<Undo2 />} onClick={() => setUndoing(d)}>Undo</Button> },
  ];

  return (
    <Page>
      {header}

      <Card className="mb-4">
        <CardHeader title="Bring in a file"
          description="Every row is checked and shown before anything is saved; then all of it is saved at once." />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-grey-700">What the file holds</span>
              <Segmented<ImportKind> value={kind} onChange={(k) => { setKind(k); reset(); setSendVouchers(false); }}
                options={[{ value: "guests", label: KIND_WORDS.guests }, { value: "bookings", label: KIND_WORDS.bookings }]} />
            </div>
            <Field label="The old system" required>
              {(f) => (
                <Input {...fieldProps(f)} value={system} placeholder={lastSystem || "IDS, eZee, our spreadsheet"}
                  maxLength={60} onChange={(e) => setSystem(e.target.value)} className="w-56" />
              )}
            </Field>
            <Button variant="primary" leadingIcon={<FileUp />} loading={busy === "check"}
              onClick={() => input.current?.click()}>
              {file ? "Choose another file" : "Choose the file"}
            </Button>
            <input ref={input} type="file" className="hidden" aria-label="The old system's file"
              accept=".xlsx,.csv,.txt"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) choose(f); }} />
          </div>
          <p className="text-sm text-grey-600">
            {kind === "guests"
              ? "Name, phone, email, address, nationality, ID type and number (only its last four are kept), date of birth, company and GSTIN, notes. A guest already on file by phone or email is shown, and you choose: keep, merge (only empty fields are filled) or skip."
              : `Bookings to come become ordinary confirmed bookings, never overbooked; a rate left blank is a dash, set at the desk before arrival. An advance becomes a payment on the booking, dated the day it was paid (before ${dateShort(v.firstDay)}), never an invoice. A stay already over comes in as history only: no bill, no tax, no report changes.`}
          </p>
          {kind === "bookings" && (
            <div className="space-y-1">
              <Checkbox checked={sendVouchers} onCheckedChange={setSendVouchers}
                disabled={!v.voucherOn} label="Send each guest our booking voucher" />
              <p className="text-sm text-grey-600 pl-6">
                {!v.voucherOn
                  ? "The booking voucher is switched off at this hotel (Settings, Messages), so none goes."
                  : sendVouchers
                    ? "Each booking's guest with an email is sent this hotel's voucher, with its new reference, once it is brought in."
                    : "Off: their old system confirmed them, so no message goes to these guests now. Later messages follow the hotel's settings, as for any booking."}
              </p>
            </div>
          )}
          {problem && (
            <p className="text-sm rounded-md border border-brand-red-100 bg-brand-red-50 px-3 py-2 text-ink-900" role="alert">{problem}</p>
          )}
        </CardBody>
      </Card>

      {check && file && (
        <>
          <Card className="mb-4">
            <CardHeader title="The file's columns" description={`${file.name}. Matched by their headings; change any that is wrong. This match is kept for the next file.`} />
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {check.fields.map((f) => (
                  <Field key={f.key} label={f.label} required={f.required} hint={f.note ?? undefined}>
                    {(p) => (
                      <NativeSelect {...fieldProps(p)} value={columns[f.key] ?? ""}
                        onChange={(e) => { setColumns((c) => ({ ...c, [f.key]: e.target.value })); setStale(true); }}>
                        <option value="">Not in the file</option>
                        {check.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                      </NativeSelect>
                    )}
                  </Field>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardHeader title="Every row, before anything is saved"
              description={counts ? [
                `${counts.rows} rows`, counts.faults && `${counts.faults} with a fault in the file`,
                counts.toChoose && `${counts.toChoose} to choose for`,
                counts.new && many(counts.new, "new guest"), counts.merge && `${counts.merge} to merge`,
                counts.skip && `${counts.skip} to skip`, counts.bookings && many(counts.bookings, "booking"),
                counts.noRate && `${counts.noRate} with no rate`, counts.stays && many(counts.stays, "past stay"),
                counts.refused && `${counts.refused} refused`,
              ].filter(Boolean).join(" · ") : undefined}
              actions={
                <>
                  <Button loading={busy === "check"} onClick={() => void ask(file, false, columns)}>Check again</Button>
                  <Button variant="primary" loading={busy === "save"} disabled={saveBlocked !== null}
                    title={saveBlocked ?? undefined} onClick={() => void ask(file, true, columns)}>
                    Bring in {saving} {saving === 1 ? "row" : "rows"}
                  </Button>
                </>
              } />
            {dupes.length > 1 && (
              <CardBody className="flex flex-wrap items-center gap-2 border-b border-grey-200 text-sm">
                <span className="text-grey-600">{dupes.length} already on file. For all of them:</span>
                <Button size="sm" onClick={() => everyDupe(() => ({ action: "keep" }))}>Keep</Button>
                <Button size="sm" onClick={() => everyDupe((r) => r.matches!.length === 1
                  ? { action: "merge", guestId: r.matches![0]!.id } : choices[String(r.line)] ?? { action: "keep" })}>
                  Merge where one matches
                </Button>
                <Button size="sm" onClick={() => everyDupe(() => ({ action: "skip" }))}>Skip</Button>
              </CardBody>
            )}
            {check.ok === false && (counts?.faults ?? 0) > 0 && (
              <CardBody className="text-sm text-brand-red-700 border-b border-grey-200">
                Nothing is saved until every fault below is corrected in the file and it is checked again.
              </CardBody>
            )}
            <DataTable<ImportRow> rows={check.rows} rowKey={(r) => String(r.line)} columns={rowColumns}
              empty={<EmptyState compact title="No rows" description="Match the required columns, then check again." />} />
          </Card>
        </>
      )}

      {(v.noRate?.length ?? 0) > 0 && (
        <Card className="mb-4">
          <CardHeader title="Bookings with no rate yet"
            description="Brought in with none. Set each one's rate before the guest arrives (Change rate, on its bill); check-in refuses it until then." />
          <DataTable rows={v.noRate!} rowKey={(r) => r.id} columns={[
            { key: "ref", header: "Booking", cell: (r) => <span className="tabular">{r.reference}</span> },
            { key: "guest", header: "Guest", cell: (r) => r.guest },
            { key: "arrival", header: "Arrival", cell: (r) => <span className="tabular">{dateShort(r.arrival)}</span> },
            { key: "type", header: "Room type", hideBelow: "md", cell: (r) => r.roomType },
            { key: "rate", header: "Rate", numeric: true, cell: () => "-" },
          ]} />
        </Card>
      )}

      <Card>
        <CardHeader title="Brought in here" description="Each file: who, when, rows in and rows refused. Undo takes all of it back, while nothing has touched it." />
        <DataTable<ImportRecord> rows={v.imports ?? []} rowKey={(d) => d.id} columns={historyColumns}
          empty={<EmptyState compact title="Nothing brought in yet" description="A file brought in is listed here." />} />
      </Card>

      <Dialog open={!!undoing} onOpenChange={(o) => { if (!o) setUndoing(null); }}>
        {undoing && (
          <DialogContent title="Undo this import?" size="sm"
            description={`${undoing.fileName}, ${dateTime(undoing.madeAt)}. Every guest, booking, advance and past stay it brought in is taken away, and the empty fields it filled are empty again. Refused if anything has touched them since.`}
            footer={
              <div className="flex gap-2 w-full justify-end">
                <Button onClick={() => setUndoing(null)}>Keep it</Button>
                <Button variant="danger" onClick={async () => {
                  const out = await undoImport(hotelId, undoing.id);
                  setUndoing(null);
                  if (!out.ok) { toast.error("Not undone", out.reason); return; }
                  toast.success("Undone", `${undoing.fileName}: everything it brought in is taken away.`);
                  void qc.invalidateQueries();
                }}>Undo it</Button>
              </div>
            }>
            {null}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!refusedOf} onOpenChange={(o) => { if (!o) setRefusedOf(null); }}>
        {refusedOf && (
          <DialogContent title="Rows not brought in" description={`${refusedOf.fileName}: these rows are not in the system. Enter them at the desk, or correct them and bring them in again.`}
            footer={<Button onClick={() => setRefusedOf(null)}>Close</Button>}>
            <ul className="space-y-1 text-sm">
              {refusedOf.refused.map((r) => (
                <li key={r.line}><span className="tabular text-grey-600">Row {r.line}:</span> {r.reason}</li>
              ))}
            </ul>
          </DialogContent>
        )}
      </Dialog>
    </Page>
  );
}

const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const choiceValue = (c: ImportChoice | undefined) => (!c ? "" : c.action === "merge" ? `merge:${c.guestId}` : c.action);
const choiceOf = (v: string): ImportChoice =>
  v.startsWith("merge:") ? { action: "merge", guestId: v.slice(6) } : v === "skip" ? { action: "skip" } : { action: "keep" };
