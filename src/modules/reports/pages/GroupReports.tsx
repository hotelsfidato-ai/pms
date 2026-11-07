import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dateShort } from "@/lib/format";
import { can, type Role } from "@/lib/permissions";
import { Checkbox, Field, Input, NativeSelect, ReadFailed, Skeleton, fieldProps, readError } from "@/components/ui";
import { ReportShell } from "@/modules/reports/components/ReportShell";
import { ReportView, factsLine } from "@/modules/reports/components/ReportView";
import { GROUP_REPORTS, getGroupReport, groupQuery, type GroupReportKey } from "@/modules/reports/data/document";
import { monthOf } from "@/modules/reports/data/statistics";
import { useHotelsWhere } from "@/modules/reports/groupHotels";

/* ══════════════════════════════════════════════════════════════════
   GROUP REPORTS - `/group-reports` (D27-383 item 6)

   The main reports for several properties at once: each property's line
   and a total. Only the properties the person may read that report at
   are offered, and the server asks again at every one; a refusal is shown
   in its own words. The total adds like with like (reports/group.ts): its
   footnotes say what was not added, and why.
   ══════════════════════════════════════════════════════════════════ */

/* The one-property reports' own rules: money owed is `invoice` (D27-147). */
const readsReports = (role: Role) => can(role, "view", "report");
const readsMoney = (role: Role) => can(role, "view", "invoice");

export default function GroupReportsPage() {
  const [key, setKey] = useState<GroupReportKey>("manager");
  const report = GROUP_REPORTS.find((r) => r.key === key)!;
  const hotels = useHotelsWhere(report.money ? readsMoney : readsReports);
  /* Every property offered, until the person unticks one. */
  const [left, setLeft] = useState<string[]>([]);
  const chosen = hotels.filter((h) => !left.includes(h.code));
  const codes = chosen.map((h) => h.code);
  /* No property past its own day: the earliest business date of those chosen. */
  const earliest = chosen.map((h) => h.businessDate).sort()[0] ?? "";
  const [asOn, setAsOn] = useState("");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const day = asOn || earliest;
  const query = report.asks === "month" ? { month: month || day.slice(0, 7) }
    : report.asks === "range" ? { from: from || monthOf(day).from, asOn: day }
    : { asOn: day };
  const named = (m: string) => { const o = monthOf(`${m}-01`); return `${o.name} ${o.year}`; };
  const period = report.asks === "month" ? (query.month ? named(query.month) : "Choose the month")
    : report.asks === "range" ? `${dateShort(query.from!)} to ${dateShort(day)}`
    : `As on ${dateShort(day)}`;

  const q = useQuery({
    queryKey: ["group-report", key, codes, query],
    queryFn: () => getGroupReport(key, codes, query),
    enabled: codes.length > 0 && Boolean(day),
    staleTime: 0,
  });
  const doc = q.data;

  const controls = (
    <div className="grid gap-4 w-full">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Report">
          {(f) => (
            <NativeSelect {...fieldProps(f)} value={key} onChange={(e) => setKey(e.target.value as GroupReportKey)}>
              {GROUP_REPORTS.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
            </NativeSelect>
          )}
        </Field>
        {report.asks === "month" ? (
          <Field label="Month">
            {(f) => <Input {...fieldProps(f)} type="month" value={query.month} max={earliest.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />}
          </Field>
        ) : (
          <>
            {report.asks === "range" && (
              <Field label="From">
                {(f) => <Input {...fieldProps(f)} type="date" value={query.from} max={day} onChange={(e) => setFrom(e.target.value)} />}
              </Field>
            )}
            <Field label={report.asks === "range" ? "To" : "As on"}>
              {(f) => <Input {...fieldProps(f)} type="date" value={day} max={earliest} onChange={(e) => setAsOn(e.target.value)} />}
            </Field>
          </>
        )}
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink-900 mb-2">Properties</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {hotels.map((h) => (
            <Checkbox key={h.code} label={h.name} checked={!left.includes(h.code)}
              onCheckedChange={(on) => setLeft((l) => (on ? l.filter((c) => c !== h.code) : [...l, h.code]))} />
          ))}
        </div>
      </fieldset>
    </div>
  );

  return (
    <ReportShell
      heading="Group reports"
      group
      title={doc?.title ?? report.title}
      property={doc?.property.name}
      period={period}
      meta={doc ? factsLine(doc.facts) : undefined}
      controls={controls}
      download={{
        ready: Boolean(doc),
        /* The same question as the screen's, so the file and the screen cannot differ. */
        path: (kind) => `/api/group/reports/${key}.${kind}?${groupQuery(codes, query)}`,
      }}
    >
      {hotels.length === 0 ? (
        <p className="py-10 text-center text-sm text-grey-500">
          You read this report at no property, so there is nothing to add up.
        </p>
      ) : codes.length === 0 ? (
        <p className="py-10 text-center text-sm text-grey-500">Tick at least one property.</p>
      ) : q.isLoading ? (
        <div className="py-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : readError(q) ? (
        <ReadFailed error={readError(q)} what="the group report" onRetry={() => void q.refetch()} />
      ) : doc ? (
        <ReportView doc={doc} />
      ) : null}
    </ReportShell>
  );
}
