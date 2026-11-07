import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { useUi } from "@/lib/ui";
import { Skeleton, ReadFailed, readError } from "@/components/ui";
import { ReportShell } from "@/modules/reports/components/ReportShell";
import { EmailReport } from "@/modules/reports/components/EmailReport";
import { ReportView, factsLine, documentCsv } from "@/modules/reports/components/ReportView";
import { getReport, type ReportKey, type ReportQuery } from "@/modules/reports/data/document";

/* ══════════════════════════════════════════════════════════════════
   ONE REPORT SCREEN — load the document, then draw it

   Every report in the owner's eZee layout (D17-62) is this: the
   property's document from the server, drawn by ReportView inside the
   report chrome. Four states, each in its own words: loading, did not
   load (with the server's reason), no such property, the report.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/** One report screen: load the document, then draw it. */
/** The question this screen asked, as the file routes take it. */
function fileQuery(query: ReportQuery): string {
  const params = new URLSearchParams();
  if (query.asOn) params.set("asOn", query.asOn);
  if (query.month) params.set("month", query.month);
  if (query.year) params.set("year", String(query.year));
  if (query.from) params.set("from", query.from);
  if (query.ignoreZero !== undefined) params.set("ignoreZero", query.ignoreZero ? "1" : "0");
  if (query.supplier) params.set("supplier", query.supplier);
  if (query.account) params.set("account", query.account);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function DocumentReport({
  report, title, period, query, what, controls,
}: {
  report: ReportKey;
  /** The screen's heading while the document is loading. */
  title: string;
  period: string;
  /** Absent while the screen still needs a choice (a statement's supplier): nothing is asked. */
  query: ReportQuery | undefined;
  what: string;
  controls?: import("react").ReactNode;
}) {
  const hotelId = useHotel();
  const q = useQuery({
    queryKey: ["report", report, hotelId, query],
    queryFn: () => getReport(hotelId, report, query!),
    enabled: Boolean(hotelId && query),
    /* The Manager report is read afresh each time it opens, as the
       Dashboard's copy of it is (D27-151): kept for the session, it showed
       a booking voided since as still sold. */
    ...(report === "manager" ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
  const doc = q.data;

  return (
    <ReportShell
      title={doc?.title ?? title}
      property={doc?.property.name}
      period={period}
      meta={doc ? factsLine(doc.facts, doc.property.timezone) : undefined}
      csv={doc ? () => documentCsv(doc) : undefined}
      controls={controls}
      download={{
        ready: Boolean(doc),
        /* The server's file routes, asked the same question the screen
           asked, so the file and the screen cannot show two answers. */
        path: (kind) => `/api/hotels/${hotelId}/reports/${report}.${kind}${fileQuery(query ?? {})}`,
      }}
      /* The same question again, so the email and the screen cannot differ. */
      email={<EmailReport hotel={hotelId} report={report} title={doc?.title ?? title} ready={Boolean(doc)}
        query={Object.fromEntries(new URLSearchParams(fileQuery(query ?? {})))} />}
    >
      {q.isLoading ? (
        <div className="py-4 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : readError(q) ? (
        <ReadFailed error={readError(q)} what={what} onRetry={() => void q.refetch()} />
      ) : doc ? (
        <ReportView doc={doc} />
      ) : !query ? (
        <p className="py-10 text-center text-sm text-grey-500">Choose above what the report is of.</p>
      ) : (
        <p className="py-10 text-center text-sm text-grey-500">
          This property has no report to show.
        </p>
      )}
    </ReportShell>
  );
}

