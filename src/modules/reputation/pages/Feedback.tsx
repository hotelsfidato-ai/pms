import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { format } from "date-fns";
import { MessageSquareHeart } from "lucide-react";
import { dateTime, NO_DATE } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, CardHeader, InfoButton, DataTable, type Column,
  StatusPill, Skeleton, ErrorState, EmptyState,
} from "@/components/ui";
import { getFeedback, type FeedbackAnswer, type FeedbackMonth } from "@/modules/reputation/data/feedback";
import { ExportButtons, type ExportColumn } from "@/modules/reports";

/* Each answer in a file (D27-383 item 1). A part not scored is a dash. */
const ANSWER_EXPORT: ExportColumn<FeedbackAnswer>[] = [
  { label: "Answered", value: (a) => a.answeredAt, kind: "datetime" },
  { label: "Guest", value: (a) => a.guest },
  { label: "Booking", value: (a) => a.reference },
  { label: "Room", value: (a) => a.roomNumber },
  { label: "Overall", value: (a) => a.overall, kind: "count" },
  { label: "Room score", value: (a) => a.room, kind: "count" },
  { label: "Cleanliness", value: (a) => a.cleanliness, kind: "count" },
  { label: "Food", value: (a) => a.food, kind: "count" },
  { label: "Staff", value: (a) => a.staff, kind: "count" },
  { label: "Low (1-2)", value: (a) => (a.low ? "Yes" : "No") },
  { label: "Comment", value: (a) => a.comment },
];

/* ══════════════════════════════════════════════════════════════════
   GUEST FEEDBACK (D27-383 item 10; built under D27-396)

   What guests answered on their own page after check-out: the scores by
   month, and the latest answers with their comments. For the owner, an
   administrator and the GM (the server's FEEDBACK_ROLES), who also get a
   low answer - a 1 or a 2, overall or in any part - in Notifications.

   A part nobody scored is a dash, never a zero. Whether the hotel asks is
   Settings, Modules, "Feedback survey" (off to start); answers already
   given stay here when it is switched off.
   ══════════════════════════════════════════════════════════════════ */

const score = (n: number | null) => (n === null ? NO_DATE : n.toFixed(1));
/* A month as people say it: "Nov 2026" (no helper in format.ts says a month). */
const monthWords = (m: string) => format(new Date(`${m}-01T00:00:00`), "MMM yyyy");
const PARTS = ["room", "cleanliness", "food", "staff"] as const;
const PART_WORD = { room: "Room", cleanliness: "Cleanliness", food: "Food", staff: "Staff" } as const;

export default function FeedbackPage() {
  const { code = "" } = useParams<{ code: string }>();
  const q = useQuery({ queryKey: ["feedback", code], queryFn: () => getFeedback(code), enabled: !!code });

  const monthColumns: Column<FeedbackMonth>[] = [
    { key: "month", header: "Month", cell: (m) => <span className="font-medium text-ink-900">{monthWords(m.month)}</span> },
    { key: "answers", header: "Answers", numeric: true, cell: (m) => m.answers },
    { key: "overall", header: "Overall", numeric: true, cell: (m) => <span className="font-medium">{score(m.overall)}</span> },
    ...PARTS.map((p): Column<FeedbackMonth> => ({
      key: p, header: PART_WORD[p], numeric: true, hideBelow: "md", cell: (m) => score(m[p]),
    })),
    { key: "low", header: "Low (1-2)", numeric: true,
      cell: (m) => m.low ? <span className="font-medium text-brand-red-700">{m.low}</span> : "0" },
  ];

  const answerColumns: Column<FeedbackAnswer>[] = [
    {
      key: "guest", header: "Guest",
      cell: (a) => (
        <div className="min-w-0">
          <div className="font-medium text-ink-900">{a.guest}</div>
          <div className="text-xs text-grey-500 tabular">{a.reference} · room {a.roomNumber}</div>
          <div className="text-xs text-grey-500">{dateTime(a.answeredAt)}</div>
        </div>
      ),
    },
    {
      key: "overall", header: "Overall", width: "w-[110px]",
      cell: (a) => <StatusPill tone={a.low ? "danger" : a.overall >= 4 ? "success" : "neutral"}>{a.overall} of 5</StatusPill>,
    },
    {
      key: "parts", header: "The parts", hideBelow: "md",
      cell: (a) => (
        <span className="text-sm text-grey-600 tabular">
          {PARTS.map((p) => `${PART_WORD[p]} ${a[p] ?? NO_DATE}`).join(" · ")}
        </span>
      ),
    },
    {
      key: "comment", header: "Comment",
      cell: (a) => a.comment
        ? <p className="text-sm text-ink-900 whitespace-pre-line break-words">{a.comment}</p>
        : <span className="text-grey-500">{NO_DATE}</span>,
    },
  ];

  const body = (() => {
    if (q.data === undefined) {
      if (q.isError) {
        return <Card><ErrorState title="Guest feedback did not load" error={q.error} onRetry={() => void q.refetch()} /></Card>;
      }
      return <Skeleton className="h-64" />;
    }
    const page = q.data;
    return (
      <div className="space-y-3">
        {!page.on && (
          <Card>
            <CardBody className="text-sm text-grey-700" data-feedback-off>
              This hotel is not asking guests for feedback. The owner or an administrator switches it on in
              Settings, Property, Modules: Feedback survey. Answers already given stay here.
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1 min-w-0">
              <h3 className="text-md font-semibold text-ink-900">Scores by month</h3>
              <InfoButton>{"The average of each score, out of 5, for the answers given that month. The last 12 months."}</InfoButton>
            </div>
          </CardHeader>
          <DataTable columns={monthColumns} rows={page.months} rowKey={(m) => m.month}
            className="border-0 rounded-t-none"
            empty={<EmptyState icon={<MessageSquareHeart />} title="No answers yet"
              description="A guest is asked on their own page after check-out, once a stay." />} />
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1 min-w-0">
              <h3 className="text-md font-semibold text-ink-900">Latest answers</h3>
              <InfoButton>{`The latest ${page.latest}, newest first. A 1 or a 2, overall or in any part, is red and goes to Notifications for a week.`}</InfoButton>
            </div>
          </CardHeader>
          <DataTable columns={answerColumns} rows={page.answers} rowKey={(a) => a.id}
            className="border-0 rounded-t-none"
            empty={<EmptyState icon={<MessageSquareHeart />} title="No answers yet"
              description="Each answer and its comment will be listed here." />} />
        </Card>
      </div>
    );
  })();

  return (
    <Page>
      <PageHeader title="Guest feedback"
        description="What guests answered on their own page after check-out: scores out of 5 and their comments."
        actions={<ExportButtons screen="feedback" rows={q.data?.answers} columns={ANSWER_EXPORT} />} />
      {body}
    </Page>
  );
}
