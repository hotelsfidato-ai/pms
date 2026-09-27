import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Bell } from "lucide-react";
import { relative } from "@/lib/format";
import { Page, PageHeader, Card, CardBody, StatusPill, Skeleton, ErrorState, EmptyState, type Tone } from "@/components/ui";
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
        /* The kit's empty state, the same words. */
        <Card>
          <EmptyState
            compact
            icon={<Bell />}
            title="Nothing needs attention"
            description="No arrivals outstanding, no balances carrying into departure, no refunds due."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((n) => (
            <Card key={n.id}>
              {/* On a phone the words take the card's width under the pill
                  and the time, rather than a column squeezed between them. */}
              <CardBody className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <StatusPill tone={NOTE_TONE[n.category] ?? "neutral"} dot>
                  {n.category}
                </StatusPill>
                <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                  <p className="text-base font-medium text-ink-900">{n.title}</p>
                  <p className="text-sm text-grey-600 mt-0.5">{n.body}</p>
                </div>
                <div className="shrink-0 text-right max-sm:ml-auto max-sm:flex max-sm:items-baseline max-sm:gap-3">
                  <p className="text-xs text-grey-500 tabular">{relative(n.at)}</p>
                  {n.link && (
                    <Link to={n.link} className="text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4">
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
