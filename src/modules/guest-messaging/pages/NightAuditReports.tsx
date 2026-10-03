import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, Page, PageHeader, ReadFailed, toast } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { getReportEmails, setReportEmails, type ReportEmails } from "../data/settings";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES → REPORTS AFTER THE NIGHT AUDIT (D27-261, Q7)

   Which of the six reports go, as PDF, to which of this hotel's people,
   each time the night audit completes. To their own sign-in email only:
   nobody types an address. Each report is built as that person would see
   it themselves.
   ══════════════════════════════════════════════════════════════════ */

const key = (report: string, staffId: string) => `${report}|${staffId}`;

export default function NightAuditReports() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["report-emails", hotel], queryFn: () => getReportEmails(hotel), enabled: !!hotel });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (q.data) setPicked(new Set(q.data.chosen.map((c) => key(c.report, c.staffId))));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (chosen: ReportEmails["chosen"]) => setReportEmails(hotel, chosen),
    onSuccess: () => { toast.success("Saved"); void qc.invalidateQueries({ queryKey: ["report-emails", hotel] }); },
    onError: (e) => toast.error("Not saved", e instanceof Error ? e.message : undefined),
  });
  const toggle = (k: string, on: boolean) =>
    setPicked((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });

  return (
    <Page>
      <PageHeader title="Reports after the night audit"
        description="Each report goes as a PDF to the people ticked, to their own sign-in email, when the night audit completes." />
      {q.isError && <ReadFailed error={q.error} what="who gets the reports" onRetry={() => void q.refetch()} />}
      {q.data && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-grey-600">
                <th className="px-4 py-2.5 font-medium">Person</th>
                {q.data.reports.map((r) => <th key={r.key} className="px-3 py-2.5 font-medium">{r.title}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {q.data.people.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <p className="text-ink-900">{p.name}</p>
                    <p className="text-xs text-grey-500">{p.email}</p>
                  </td>
                  {q.data.reports.map((r) => (
                    <td key={r.key} className="px-3 py-2.5">
                      <Checkbox aria-label={`${r.title} to ${p.name}`} checked={picked.has(key(r.key, p.id))}
                        onCheckedChange={(on) => toggle(key(r.key, p.id), on)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-grey-100">
            <Button loading={save.isPending} onClick={() => save.mutate([...picked].map((k) => {
              const [report, staffId] = k.split("|");
              return { report: report!, staffId: staffId! };
            }))}>Save</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
