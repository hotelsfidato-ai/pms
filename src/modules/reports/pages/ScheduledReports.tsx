import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import {
  Button, Card, CardBody, Dialog, DialogContent, EmptyState, Field, NativeSelect, Page, PageHeader, ReadFailed,
  Segmented, Skeleton, StatusPill, Textarea, fieldProps, toast,
} from "@/components/ui";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  PERIOD_WORDS, getSchedules, removeSchedule, saveSchedule,
  type Frequency, type Period, type Schedule, type ScheduleInput, type Schedules,
} from "@/modules/reports/data/emails";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES → SCHEDULED REPORTS (the owner's D27-383 item 5)

   For this hotel: any report by email, after the night audit of its day -
   every day, once a week on a chosen day, or once a month on a chosen
   date - for a period worked out from the day closed, as a PDF or Excel,
   to the addresses typed. Paused, changed and taken off here; the last
   send and its result shown. The owner, an Administrator or the GM; the
   server asks again on every call and says why it refuses.
   ══════════════════════════════════════════════════════════════════ */

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FILE_WORDS = { pdf: "PDF", xlsx: "Excel" } as const;
const LAST_WORDS = { sent: "Sent", failed: "Failed", refused: "Not sent" } as const;

/** Typed one a line, or with commas: the server checks each. */
const addressesIn = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

type Draft = Omit<ScheduleInput, "addresses"> & { text: string };
const NEW: Draft = {
  report: "", period: "last-week", frequency: "weekly", weekday: 1, dayOfMonth: 1, fileType: "pdf",
  isPaused: false, text: "",
};
const toInput = (d: Draft): ScheduleInput => ({
  report: d.report, period: d.period, frequency: d.frequency,
  weekday: d.frequency === "weekly" ? d.weekday : null,
  dayOfMonth: d.frequency === "monthly" ? d.dayOfMonth : null,
  fileType: d.fileType, addresses: addressesIn(d.text), isPaused: d.isPaused,
});
const draftOf = (s: Schedule): Draft => ({ ...s, weekday: s.weekday ?? 1, dayOfMonth: s.dayOfMonth ?? 1,
  text: s.addresses.join("\n") });

export default function ScheduledReports() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["report-schedules", hotel], queryFn: () => getSchedules(hotel), enabled: !!hotel });
  /* The schedule being added (id null) or changed, or none. */
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["report-schedules", hotel] });

  const save = useMutation({
    mutationFn: (v: { id: string | null; input: ScheduleInput }) => saveSchedule(hotel, v.id, v.input),
    onSuccess: (_, v) => {
      toast.success(v.id ? "Saved" : "Schedule added");
      setEditing(null);
      done();
    },
    onError: (e) => toast.error("Not saved", e instanceof Error ? e.message : undefined),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeSchedule(hotel, id),
    onSuccess: () => { toast.success("Schedule taken off"); setRemoving(null); done(); },
    onError: (e) => toast.error("Not taken off", e instanceof Error ? e.message : undefined),
  });

  return (
    <Page>
      <PageHeader title="Scheduled reports"
        description="Any report by email, after the night audit closes its day: every day, once a week or once a month."
        actions={q.data && (
          <Button variant="primary" onClick={() => setEditing({ id: null, draft: NEW })}>
            <Plus className="size-4" />
            Add a schedule
          </Button>
        )} />
      {q.isError && <ReadFailed error={q.error} what="the scheduled reports" onRetry={() => void q.refetch()} />}
      {q.isLoading && (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      )}
      {q.data?.notConnected && (
        <Card className="mb-5 border-brand-yellow-100 bg-brand-yellow-50">
          <CardBody>
            <p className="text-sm text-ink-900 leading-relaxed">
              <span className="font-medium">Nothing is sent yet</span>{" - "}{q.data.notConnected}
            </p>
          </CardBody>
        </Card>
      )}
      {q.data && (q.data.schedules.length === 0 ? (
        <Card>
          <EmptyState compact icon={<CalendarClock />} title="No report goes on a schedule yet"
            description="Add one: the report, the days it covers, how often it goes, and who gets it." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-grey-100">
            {q.data.schedules.map((s) => (
              <li key={s.id} className="px-4 py-3.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink-900 flex items-center gap-2">
                    {s.title}
                    {s.isPaused && <StatusPill tone="neutral">Paused</StatusPill>}
                  </p>
                  <p className="text-sm text-grey-600 mt-0.5">
                    {PERIOD_WORDS[s.period]}, {s.when}, as {FILE_WORDS[s.fileType]}
                  </p>
                  <p className="text-sm text-grey-600 break-words">To {s.addresses.join(", ")}</p>
                  <p className="text-xs text-grey-500 mt-0.5">
                    {s.last
                      ? `Last: ${LAST_WORDS[s.last.status]} for the day ${dateShort(s.last.date)}${s.last.detail ? ` - ${s.last.detail}` : ""}`
                      : "Not sent yet."}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="secondary" loading={save.isPending && save.variables?.id === s.id}
                    onClick={() => save.mutate({ id: s.id, input: toInput({ ...draftOf(s), isPaused: !s.isPaused }) })}>
                    {s.isPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ id: s.id, draft: draftOf(s) })}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(s)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {editing && q.data && (
        <ScheduleForm reports={q.data.reports} editing={editing} saving={save.isPending}
          onClose={() => setEditing(null)} onSave={(input) => save.mutate({ id: editing.id, input })} />
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing && (
          <DialogContent size="sm" title="Take this schedule off?"
            description={`${removing.title}, ${removing.when}. Nothing more is sent by it; what was sent stays recorded.`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setRemoving(null)}>Keep it</Button>
                <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(removing.id)}>
                  Take it off
                </Button>
              </>
            }>
            <p className="text-sm text-grey-600">To pause it instead, press Pause: it keeps its addresses.</p>
          </DialogContent>
        )}
      </Dialog>
    </Page>
  );
}

function ScheduleForm({ reports, editing, saving, onClose, onSave }: {
  reports: Schedules["reports"];
  editing: { id: string | null; draft: Draft };
  saving: boolean;
  onClose: () => void;
  onSave: (input: ScheduleInput) => void;
}) {
  const [d, setD] = useState<Draft>(editing.draft);
  const change = (part: Partial<Draft>) => setD((x) => ({ ...x, ...part }));
  const schedulable = reports.filter((r) => r.periods.length > 0);
  const periods = reports.find((r) => r.key === d.report)?.periods ?? [];
  const pickReport = (key: string) => {
    const allowed = reports.find((r) => r.key === key)?.periods ?? [];
    change({ report: key, period: allowed.includes(d.period) ? d.period : allowed[0] ?? d.period });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={editing.id ? "Change the schedule" : "Add a schedule"}
        description="It goes after the night audit closes the day; a day never closed sends nothing."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!d.report || addressesIn(d.text).length === 0}
              onClick={() => onSave(toInput(d))}>
              Save
            </Button>
          </>
        }>
        <div className="space-y-4">
          <Field label="Report" hint="Yearly statistics, and a statement of one supplier or account, cannot go on a schedule.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={d.report} onChange={(e) => pickReport(e.target.value)}>
                <option value="" disabled>Choose a report</option>
                {schedulable.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Days it covers"
            hint={periods.length === 1 ? "A report of a whole month goes for last month only: this month is not closed yet." : undefined}>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={d.period} disabled={!d.report}
                onChange={(e) => change({ period: e.target.value as Period })}>
                {(periods.length ? periods : (Object.keys(PERIOD_WORDS) as Period[])).map((p) =>
                  <option key={p} value={p}>{PERIOD_WORDS[p]}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="How often">
            {() => (
              <Segmented<Frequency> value={d.frequency} onChange={(frequency) => change({ frequency })}
                options={[{ value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" },
                  { value: "monthly", label: "Every month" }]} />
            )}
          </Field>
          {d.frequency === "weekly" && (
            <Field label="After the night audit of" className="max-w-xs">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={d.weekday ?? 1} onChange={(e) => change({ weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
                </NativeSelect>
              )}
            </Field>
          )}
          {d.frequency === "monthly" && (
            <Field label="After the night audit of the" hint="1 to 28, so every month has it." className="max-w-xs">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={d.dayOfMonth ?? 1} onChange={(e) => change({ dayOfMonth: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </NativeSelect>
              )}
            </Field>
          )}
          <Field label="File">
            {() => (
              <Segmented value={d.fileType} onChange={(fileType) => change({ fileType })}
                options={[{ value: "pdf", label: "PDF" }, { value: "xlsx", label: "Excel" }]} />
            )}
          </Field>
          <Field label="Send to" hint="One email address a line.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} placeholder="name@example.com" value={d.text}
                onChange={(e) => change({ text: e.target.value })} />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
