import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, Link } from "react-router";
import { Check, AlertTriangle, ArrowRight, MoonStar } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong, money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, Skeleton, Tooltip,
  ErrorState, Term,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { getNightAudit, runNightAudit, type NightAuditResult } from "@/modules/night-audit/data/nightAudit";

/* ══════════════════════════════════════════════════════════════════
   NIGHT AUDIT

   The checklist is the part a manager reads; the roll-over is the
   part the machine does.

   Run was disabled for six checkpoints, with the reason written on it:
   "the business date is a constant in this stage — posting room
   charges without advancing the date would double-charge every
   occupied room the next time anyone pressed the button." CP11 met
   that condition. The date comes from night_audit_runs now, and this
   button is what writes to it.

   `canRun` is not computed here. It comes from the same function the
   server uses to refuse the request, so a button that looks pressable
   and a request that gets refused cannot disagree — which is what
   Rule 6 is actually for.
   ══════════════════════════════════════════════════════════════════ */

export default function NightAuditPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["night-audit", hotelId],
    queryFn: () => getNightAudit(hotelId),
  });

  const queryClient = useQueryClient();
  const [result, setResult] = useState<NightAuditResult | null>(null);

  const run = useMutation({
    mutationFn: () => runNightAudit(hotelId),
    onSuccess: async (r) => {
      setResult(r);
      /* The business date has MOVED. Two things are now stale, and
         only invalidating the first is how this shipped broken once:

           · every cached query, computed against the old date
           · BUSINESS_DATE itself, which the session learned at sign-in
             and nothing else updates

         Refresh first. Invalidating queries that then refetch against
         a stale date just caches the wrong answer again. */
      await useSession.getState().refresh();
      await queryClient.invalidateQueries();
    },
  });

  const attention = data?.checks.filter((c) => c.state === "attention") ?? [];

  return (
    <Page>
      <PageHeader
        title="Night audit"
        description={
          data
            ? <>The <Term name="nightAudit">night audit</Term> is closing {dateLong(data.businessDate)} and opening {dateLong(data.nextBusinessDate)}.</>
            : <>The <Term name="nightAudit">night audit</Term> closes the business date.</>
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
                          c.state === "ok" ? "text-grey-500" : "text-brand-yellow",
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
                      className={cn(
                        "inline-flex items-center gap-1.5 text-sm text-brand-orange-700 hover:underline shrink-0 mt-0.5",
                        /* The action on the card, not a word in a
                           sentence — 53x20px is a link, and this is
                           a button wearing a link's clothes. */
                        "pointer-coarse:min-h-11",
                      )}
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
                <p className="text-2xs text-grey-500 mt-1.5">
                  Last run: {data.lastRun ?? "never — this property has not closed a date in this system"}
                </p>
              </div>
              <Tooltip content={data.canRun.reason ?? ""}>
                {/* Rule 6: refused, visible, and explained — not removed. */}
                <span className="shrink-0">
                  <Button variant="primary"
                    disabled={!data.canRun.allowed || run.isPending}
                    onClick={() => run.mutate()}
                  >
                    {run.isPending ? "Closing the day…" : "Run night audit"}
                  </Button>
                </span>
              </Tooltip>
            </CardBody>
          </Card>

          {run.isError && (
            <Card className="mt-4 border-red-200 bg-red-50/50">
              <CardBody>
                <p className="text-sm text-red-900">
                  {describeError(run.error).message ??
                    "The day was not closed. Nothing was changed."}
                </p>
              </CardBody>
            </Card>
          )}

          {result?.ok && (
            <Card className="mt-4 border-green-200 bg-green-50/50">
              <CardBody className="space-y-1.5">
                <p className="text-sm font-medium text-green-900">
                  {dateLong(result.businessDate)} is closed.
                  {result.nextBusinessDate
                    ? ` The property is now operating in ${dateLong(result.nextBusinessDate)}.`
                    : ""}
                </p>
                <p className="text-2xs text-green-800">
                  {result.roomsPosted ?? 0} room
                  {result.roomsPosted === 1 ? "" : "s"} posted
                  {typeof result.revenuePosted === "number"
                    ? ` · ${money(result.revenuePosted)}`
                    : ""}
                  {result.complimentary
                    ? ` · ${result.complimentary} complimentary, not charged`
                    : ""}
                  {result.noShows
                    ? ` · ${result.noShows} no-show${result.noShows === 1 ? "" : "s"}`
                    : ""}
                </p>

                {/* ── The restaurant's day ───────────────────────
                    READ, not posted. Every rupee here is already on the
                    ledger from when the till settled the order; the
                    audit states the day rather than adding to it. A
                    second copy would double the takings. */}
                {result.restaurant && result.restaurant.orders > 0 && (
                  <div className="pt-2 mt-2 border-t border-green-200">
                    <p className="text-2xs text-green-800">
                      Restaurant · {result.restaurant.orders} order
                      {result.restaurant.orders === 1 ? "" : "s"}
                      {result.restaurant.covers > 0
                        ? `, ${result.restaurant.covers} covers` : ""}
                      {" · "}{money(result.restaurant.gross)}
                      <span className="text-green-700">
                        {" "}({money(result.restaurant.net)} + {money(result.restaurant.tax)} tax)
                      </span>
                    </p>
                    {result.restaurant.byTender.length > 0 && (
                      <p className="text-2xs text-green-700 mt-0.5">
                        {result.restaurant.byTender
                          .map((t) => `${t.method} ${money(t.amount)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Two drawers, side by side ───────────────────
                    Never one figure. The desk and the till are counted
                    by different people at different times, and adding
                    them would hide which one is short. */}
                {result.drawers && (
                  <div className="pt-2 mt-2 border-t border-green-200
                                  grid gap-2 @sm:grid-cols-2">
                    <Drawer label="Front desk"
                            unit="shift" d={result.drawers.frontDesk}
                            count={result.drawers.frontDesk.shifts} />
                    <Drawer label="Till"
                            unit="outlet" d={result.drawers.till}
                            count={result.drawers.till.outlets} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

/* One counted drawer. A variance is shown as a COUNT of shifts that had
   to explain themselves, not as a rupee difference — the reason a
   drawer is short lives on the shift that closed it, and a number here
   would invite somebody to net two of them off against each other. */
function Drawer({ label, unit, d, count }: {
  label: string;
  unit: string;
  d: { opening: number; counted: number; variances: number };
  count: number;
}) {
  return (
    <div>
      <p className="text-2xs font-medium text-green-900">
        {label}
        <span className="font-normal text-green-700">
          {" · "}{count} {unit}{count === 1 ? "" : "s"} closed
        </span>
      </p>
      {count === 0 ? (
        <p className="text-2xs text-green-700">Not used today.</p>
      ) : (
        <p className="text-2xs text-green-800 tabular">
          Opened {money(d.opening)} · counted {money(d.counted)}
          {d.variances > 0
            ? ` · ${d.variances} explained variance${d.variances === 1 ? "" : "s"}`
            : ""}
        </p>
      )}
    </div>
  );
}
