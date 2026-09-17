import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Bell } from "lucide-react";
import { relative } from "@/lib/format";
import { Page, PageHeader, Card, CardBody, StatusPill, Skeleton, ErrorState, type Tone } from "@/components/ui";
import { notificationsRepo } from "@/data/repositories";
import { useUi } from "@/lib/ui";

/* Split out of Directory.tsx on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Service: core. Unchanged. */

/* The property in view: the URL's, or the one last chosen. The same five
   lines as Guests.tsx — kept beside each screen that uses them. */
function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Notifications ───────────────────────────────────────────────── */

const NOTE_TONE: Record<string, Tone> = {
  approval: "warning",
  reservation: "info",
  payment: "danger",
  automation: "accent",
  customer: "info",
  system: "neutral",
};

export function NotificationsPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", hotelId],
    queryFn: () => notificationsRepo.list(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Derived, never stored - so nothing here can go stale while the thing it describes changes."
        badge={data ? <StatusPill tone={data.length ? "warning" : "success"}>{data.length}</StatusPill> : undefined}
      />
      {error ? (
        <Card>
          <ErrorState
            title="Could not work out what needs attention"
            description="These are derived from the day's stays and postings. Nothing is lost - try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data ?? []).length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10">
              <Bell className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">Nothing needs attention</p>
              <p className="text-base text-grey-500 mt-1.5">
                No arrivals outstanding, no balances carrying into departure, no refunds due.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {(data ?? []).map((n) => (
            <Card key={n.id}>
              <CardBody className="flex items-start gap-3">
                <StatusPill tone={NOTE_TONE[n.category] ?? "neutral"} dot>
                  {n.category}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-ink-900">{n.title}</p>
                  <p className="text-sm text-grey-600 mt-0.5">{n.body}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xs text-grey-500 tabular">{relative(n.at)}</p>
                  {n.link && (
                    <Link to={n.link} className="text-sm text-brand-orange-700 hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
