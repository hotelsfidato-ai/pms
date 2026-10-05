import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Card, CardBody, Field, Page, PageHeader, ReadFailed, Switch, Textarea, fieldProps, toast,
} from "@/components/ui";
import { useUi } from "@/lib/ui";
import { getReportEmails, setReportEmails } from "../data/settings";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES → DAILY REPORT EMAILS (the owner's D27-280)

   For this hotel: each report On or Off, and the addresses it goes to.
   Right after the night audit closes the day, each report switched on
   goes to each address: its key figures in the email, the whole report
   as a PDF. The night audit report starts on, the other three off, and
   nobody gets anything until an address is typed. The owner, an
   Administrator or the GM; the server asks again on every call.
   ══════════════════════════════════════════════════════════════════ */

type Draft = Record<string, { isOn: boolean; text: string }>;

/** Typed one a line, or with commas: the server checks each. */
const addressesIn = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

export default function DailyReportEmails() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["report-emails", hotel], queryFn: () => getReportEmails(hotel), enabled: !!hotel });
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.reports.map((r) => [r.key, { isOn: r.isOn, text: r.addresses.join("\n") }])));
  }, [q.data]);
  const change = (key: string, part: Partial<Draft[string]>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key]!, ...part } }));
  const save = useMutation({
    mutationFn: () => setReportEmails(hotel, Object.entries(draft).map(([key, d]) =>
      ({ key, isOn: d.isOn, addresses: addressesIn(d.text) }))),
    onSuccess: () => { toast.success("Saved"); void qc.invalidateQueries({ queryKey: ["report-emails", hotel] }); },
    onError: (e) => toast.error("Not saved", e instanceof Error ? e.message : undefined),
  });

  return (
    <Page>
      <PageHeader title="Daily report emails"
        description="Sent right after the night audit closes the day: the key figures in the email, the whole report as a PDF." />
      {q.isError && <ReadFailed error={q.error} what="the daily report emails" onRetry={() => void q.refetch()} />}
      {q.data?.notConnected && (
        <Card className="mb-5 border-brand-yellow-100 bg-brand-yellow-50">
          <CardBody>
            <p className="text-sm text-ink-900 leading-relaxed">
              <span className="font-medium">Nothing is sent yet</span>{" - "}{q.data.notConnected}
            </p>
          </CardBody>
        </Card>
      )}
      {q.data && (
        <Card>
          <ul className="divide-y divide-grey-100">
            {q.data.reports.map((r) => {
              const d = draft[r.key];
              if (!d) return null;
              return (
                <li key={r.key} className="px-4 py-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-ink-900">{r.title}</p>
                      <p className="text-sm text-grey-600 mt-0.5">{r.contains}</p>
                      {r.changedBy && <p className="text-xs text-grey-500 mt-0.5">Last changed by {r.changedBy}</p>}
                    </div>
                    <Switch checked={d.isOn} label={<span className="sr-only">{r.title}</span>}
                      onCheckedChange={(isOn) => change(r.key, { isOn })} />
                  </div>
                  <Field label="Send to" className="max-w-xl"
                    hint={d.isOn && !addressesIn(d.text).length
                      ? "On, but nobody gets it until an address is typed."
                      : "One email address a line."}>
                    {(f) => (
                      <Textarea {...fieldProps(f)} aria-label={`Send the ${r.title} to`} rows={2}
                        placeholder="name@example.com" value={d.text}
                        onChange={(e) => change(r.key, { text: e.target.value })} />
                    )}
                  </Field>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-3 border-t border-grey-100">
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
