import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { useUi } from "@/lib/ui";
import { Skeleton, ReadFailed, readError } from "@/components/ui";
import { ReportShell } from "@/modules/reports/components/ReportShell";
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
export function DocumentReport({
  report, title, period, query, what,
}: {
  report: ReportKey;
  /** The screen's heading while the document is loading. */
  title: string;
  period: string;
  query: ReportQuery;
  what: string;
}) {
  const hotelId = useHotel();
  const q = useQuery({
    queryKey: ["report", report, hotelId, query],
    queryFn: () => getReport(hotelId, report, query),
    enabled: Boolean(hotelId),
  });
  const doc = q.data;

  return (
    <ReportShell
      title={doc?.title ?? title}
      property={doc?.property.name}
      period={period}
      meta={doc ? factsLine(doc.facts) : undefined}
      csv={doc ? () => documentCsv(doc) : undefined}
    >
      {q.isLoading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : readError(q) ? (
        <ReadFailed error={readError(q)} what={what} onRetry={() => void q.refetch()} />
      ) : doc ? (
        <ReportView doc={doc} />
      ) : (
        <p className="px-4 py-10 text-center text-base text-grey-500">
          This property has no report to show.
        </p>
      )}
    </ReportShell>
  );
}

