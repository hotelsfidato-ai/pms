import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Check, AlertTriangle, ArrowRight, MoonStar } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, Skeleton, Tooltip,
  ErrorState,
} from "@/components/ui";
import { getNightAudit } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   NIGHT AUDIT

   The checklist is the part a manager reads; the roll-over is the
   part the machine does. Only the first of those is honest to build
   today, because the business date is a constant in this stage —
   posting room charges without advancing the date would double-charge
   every occupied room the next time anyone pressed the button.

   So Run is disabled with its reason on the face of it (Rule 6), and
   everything the audit would check is computed live from the same
   ledger every other screen reads.
   ══════════════════════════════════════════════════════════════════ */

export default function NightAuditPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["night-audit", hotelId],
    queryFn: () => getNightAudit(hotelId),
  });

  const attention = data?.checks.filter((c) => c.state === "attention") ?? [];

  return (
    <Page>
      <PageHeader
        title="Night audit"
        description={
          data
            ? `Closing ${dateLong(data.businessDate)} and opening ${dateLong(data.nextBusinessDate)}.`
            : "Closing the business date."
        }
        badge={
          data ? (
            <StatusPill tone={attention.length ? "warning" : "success"}>
              {attention.length
                ? `${attention.length} to look at`
                : "Nothing outstanding"}
            </StatusPill>
          ) : undefined
        }
      />

      {error ? (
        <Card>
          <ErrorState
            title="The pre-flight checks did not run"
            description="Do not close the date on an unread checklist. Try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading || !data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="space-y-2.5 mb-6">
            {data.checks.map((c) => (
              <Card key={c.id}>
                <CardBody className="flex items-start gap-3.5">
                  <span
                    className={cn(
                      "flex items-center justify-center size-7 rounded-full shrink-0 mt-0.5",
                      c.state === "ok" ? "bg-success-50 text-success" : "bg-brand-yellow-50 text-brand-yellow",
                    )}
                  >
                    {c.state === "ok"
                      ? <Check className="size-4" />
                      : <AlertTriangle className="size-4" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-base font-medium text-ink-900">{c.label}</p>
                      <span
                        className={cn(
                          "text-base tabular font-semibold",
                          c.state === "ok" ? "text-grey-400" : "text-brand-yellow",
                        )}
                      >
                        {c.count}
                      </span>
                    </div>
                    <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">{c.detail}</p>
                  </div>

                  {c.link && c.count > 0 && (
                    <Link
                      to={c.link}
                      className="inline-flex items-center gap-1.5 text-sm text-brand-orange hover:underline shrink-0 mt-0.5"
                    >
                      Open
                      <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardBody className="flex flex-col sm:flex-row sm:items-center gap-4">
              <MoonStar className="size-5 text-grey-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-ink-900">
                  Run the audit and roll to {dateLong(data.nextBusinessDate)}
                </p>
                <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
                  {data.canRun.reason}
                </p>
                <p className="text-2xs text-grey-400 mt-1.5">
                  Last run: {data.lastRun ?? "never — this property has not closed a date in this system"}
                </p>
              </div>
              <Tooltip content={data.canRun.reason ?? ""}>
                {/* Rule 6: refused, visible, and explained — not removed. */}
                <span className="shrink-0">
                  <Button disabled={!data.canRun.allowed}>Run night audit</Button>
                </span>
              </Tooltip>
            </CardBody>
          </Card>
        </>
      )}
    </Page>
  );
}
