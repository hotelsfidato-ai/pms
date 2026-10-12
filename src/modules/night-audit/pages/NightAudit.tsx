import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, Link } from "react-router";
import { Check, AlertTriangle, ArrowRight, MoonStar } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong, dateShort, dateTime, money } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { useSession, useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, StatusPill, Skeleton, Tooltip,
  ErrorState, EmptyState, DataTable, Term, IconChip, type Column,
  Dialog, DialogContent, DialogClose,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import {
  getNightAudit, runNightAudit, listClosedDays,
  type NightAuditResult, type ClosedDay,
} from "@/modules/night-audit/data/nightAudit";
import { CorrectDay } from "@/modules/night-audit/components/CorrectDay";

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

  /* The days this property has closed (D17-13). Invalidated with
     everything else when a run succeeds. */
  const closedDays = useQuery({
    queryKey: ["night-audit-closed-days", hotelId],
    queryFn: () => listClosedDays(hotelId),
  });

  const queryClient = useQueryClient();
  const [result, setResult] = useState<NightAuditResult | null>(null);
  /* D27-117 (QA NA-1): the audit asks first. It closed the day on one click,
     and a closed day cannot be edited. */
  const [confirming, setConfirming] = useState(false);

  /* Correcting a closed day (D22-18): the owner, an administrator and the GM
     (D24-3), this month and last (D24-5). Anybody else sees a day's
     corrections, not the form. */
  const canCorrect = can(useRole(), "approve", "reservation");
  const [correcting, setCorrecting] = useState<string | null>(null);
  /* Closing the day is the right the server's gate asks (roleGate CLOSE_DAY:
     `invoice` create). A role without it - the Revenue Manager, the Viewer -
     is not shown Run at all (the owner's D27-305). */
  const mayClose = can(useRole(), "create", "invoice");

  const run = useMutation({
    /* A day already closed comes back refused WITH its record (D17-12).
       Somebody else closed it, so the history here is out of date too. */
    onError: (e) => {
      if (e instanceof ApiError && (e.body as NightAuditResult | undefined)?.alreadyClosed) {
        void queryClient.invalidateQueries({ queryKey: ["night-audit-closed-days", hotelId] });
      }
    },
    /* The day the heading names, not whatever day the server is on. A
       screen that did not see the day close elsewhere would otherwise
       close tomorrow (NA-2); sent, the server refuses it instead. */
    mutationFn: (closing: string) => runNightAudit(hotelId, closing),
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

  const refusal = run.error instanceof ApiError
    ? (run.error.body as NightAuditResult | undefined)
    : undefined;
  const alreadyMade = refusal?.alreadyClosed ? refusal.record : undefined;

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
          {/* One card of rows (the Rhythm Rule's list row: 12px top and
              bottom, a hairline between, every row's words at the same x). */}
          <Card className="mb-5">
          <ul className="divide-y divide-grey-100 px-4">
            {data.checks.map((c) => (
              <li key={c.id}>
                <div className="flex items-start gap-3.5 py-3 min-h-14">
                  <IconChip tone={c.state === "ok" ? "green" : "yellow"} className="mt-0.5">
                    {c.state === "ok" ? <Check /> : <AlertTriangle />}
                  </IconChip>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium text-ink-900">{c.label}</p>
                      <span
                        className={cn(
                          "text-sm tabular font-semibold",
                          c.state === "ok" ? "text-grey-500" : "text-brand-yellow-800",
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
                </div>
              </li>
            ))}
          </ul>
          </Card>

          <Card>
            <CardBody className="flex flex-col sm:flex-row sm:items-center gap-4">
              <IconChip><MoonStar /></IconChip>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  Run the audit and roll to {dateLong(data.nextBusinessDate)}
                </p>
                <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
                  {data.canRun.reason}
                </p>
                <p className="text-2xs text-grey-500 mt-1.5">
                  Last run: {data.lastRun ?? "never - this property has not closed a date in this system"}
                </p>
              </div>
              {mayClose && (
              <Tooltip content={data.canRun.reason ?? ""}>
                {/* Rule 6: refused, visible, and explained — not removed.
                    Removed only for a role that may never run it (D27-305). */}
                <span className="shrink-0">
                  <Button variant="primary"
                    disabled={!data.canRun.allowed || run.isPending}
                    onClick={() => setConfirming(true)}
                  >
                    {run.isPending ? "Closing the day…" : "Run night audit"}
                  </Button>
                </span>
              </Tooltip>
              )}
              <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent title={`Close ${dateLong(data.businessDate)}?`} size="sm">
                  <div className="space-y-4">
                    <p className="text-base text-grey-700 leading-relaxed">
                      The property moves to {dateLong(data.nextBusinessDate)}. Tonight's
                      room charges are posted to every guest in house and arrivals who
                      did not come become no-shows. A closed day cannot be edited, only
                      corrected afterwards.
                    </p>
                    <div className="flex gap-2">
                      <DialogClose asChild>
                        <Button variant="secondary" className="flex-1">Cancel</Button>
                      </DialogClose>
                      <Button variant="primary" className="flex-1"
                        onClick={() => { setConfirming(false); run.mutate(data.businessDate); }}>
                        Close {dateShort(data.businessDate)}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardBody>
          </Card>

          {alreadyMade ? (
            /* Not a failure: the day IS closed. Said, and shown. */
            <Card className="mt-4">
              <CardBody className="space-y-1.5">
                <p className="text-sm font-medium text-ink-900">
                  {describeError(run.error).message}
                </p>
                <p className="text-sm text-grey-600">
                  Nothing was run again. The record that was made:
                </p>
                <p className="text-sm text-grey-600 tabular">
                  Ran by {alreadyMade.ranBy ?? "-"}
                  {" · "}closed {dateTime(alreadyMade.completedAt)}
                  {" · "}rooms posted {orDash(alreadyMade.roomsPosted)}
                  {" · "}room revenue {moneyOrDash(alreadyMade.revenuePosted)}
                  {" · "}no-shows {orDash(alreadyMade.noShows)}
                </p>
              </CardBody>
            </Card>
          ) : run.isError && (
            <Card className="mt-4 border-brand-red-100 bg-brand-red-50">
              <CardBody>
                <p className="text-sm text-brand-red-700">
                  {describeError(run.error).message ??
                    "The day was not closed. Nothing was changed."}
                </p>
              </CardBody>
            </Card>
          )}

          {result?.ok && (
            <Card className="mt-4 border-success-100 bg-success-50">
              <CardBody className="space-y-1.5">
                <p className="text-sm font-medium text-success-600">
                  {dateLong(result.businessDate)} is closed.
                  {result.nextBusinessDate
                    ? ` The property is now operating in ${dateLong(result.nextBusinessDate)}.`
                    : ""}
                </p>
                <p className="text-2xs text-success-600">
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
                  <div className="pt-2 mt-2 border-t border-success-100">
                    <p className="text-2xs text-success-600">
                      Restaurant · {result.restaurant.orders} order
                      {result.restaurant.orders === 1 ? "" : "s"}
                      {result.restaurant.covers > 0
                        ? `, ${result.restaurant.covers} covers` : ""}
                      {" · "}{money(result.restaurant.gross)}
                      <span className="text-success-600">
                        {" "}({money(result.restaurant.net)} + {money(result.restaurant.tax)} tax)
                      </span>
                    </p>
                    {result.restaurant.byTender.length > 0 && (
                      <p className="text-2xs text-success-600 mt-0.5">
                        {result.restaurant.byTender
                          .map((t) => `${t.method} ${money(t.amount)}`)
                          .join(" · ")}
                      </p>
                    )}
                    {/* D27-119: food struck after the kitchen had it, and why. */}
                    {(result.restaurant.struck ?? []).map((x, i) => (
                      <p key={i} className="text-2xs text-success-600 mt-0.5">
                        Struck after the kitchen: {x.qty} × {x.name} ({money(x.value)})
                        {" · "}{x.orderNo} · {x.by ?? "-"} · {x.reason ?? "-"}
                      </p>
                    ))}
                  </div>
                )}

                {/* ── Two drawers, side by side ───────────────────
                    Never one figure. The desk and the till are counted
                    by different people at different times, and adding
                    them would hide which one is short. */}
                {result.drawers && (
                  <div className="pt-2 mt-2 border-t border-success-100
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

      {/* ── The closed days (D17-13) ───────────────────────────────
          Outside the checklist's branches on purpose: a history that
          loaded is worth reading even when the checklist did not. */}
      <Card className="mt-6">
        <CardHeader
          title="Closed days"
          description={canCorrect && firstCorrectable(data?.businessDate)
            ? `Every night audit run at this property, newest first. Days from ${dateLong(firstCorrectable(data?.businessDate))} on can be corrected; older ones stay as they are.`
            : "Every night audit run at this property, newest first."}
        />
        <DataTable<ClosedDay>
          className="border-0 rounded-t-none"
          columns={closedDayColumns(canCorrect, firstCorrectable(data?.businessDate), setCorrecting)}
          rows={closedDays.data ?? []}
          rowKey={(d) => d.businessDate}
          loading={closedDays.isLoading}
          error={closedDays.error}
          onRetry={() => closedDays.refetch()}
          empty={
            <EmptyState
              compact
              title="No day closed yet"
              description="Each night audit adds its day here: who ran it, the rooms and revenue it posted, and the no-shows."
            />
          }
        />
      </Card>

      {correcting && (
        <CorrectDay hotelId={hotelId} day={correcting} canCorrect={canCorrect}
          onClose={() => setCorrecting(null)} />
      )}
    </Page>
  );
}

/* A figure the record does not hold is a dash, never a zero. */
const orDash = (n: number | null) => (n === null ? "-" : String(n));
const moneyOrDash = (n: number | null) => (n === null ? "-" : money(n));

/** The first day that may still be corrected: the 1st of last month (D24-5). */
function firstCorrectable(businessDate: string | undefined): string | null {
  if (!businessDate) return null;
  const [y, m] = businessDate.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

function closedDayColumns(
  canCorrect: boolean, from: string | null, open: (day: string) => void,
): Column<ClosedDay>[] {
  return [
    {
      key: "day", header: "Day",
      cell: (d) => (
        <span className="inline-flex items-center gap-2">
          {dateShort(d.businessDate)}
          {(d.corrections ?? 0) > 0 && <StatusPill tone="info">Corrected</StatusPill>}
        </span>
      ),
    },
    /* Nobody was recorded before 17 September: a dash, not a guess. */
    { key: "ranBy", header: "Ran by", cell: (d) => d.ranBy ?? "-" },
    { key: "closed", header: "Closed", cell: (d) => dateTime(d.completedAt), hideBelow: "md" },
    { key: "rooms", header: "Rooms posted", numeric: true, cell: (d) => orDash(d.roomsPosted) },
    /* The room charges the audit posted, before tax - and, once a room charge
       of the day is corrected, what they came to after (D24-6). */
    {
      key: "revenue", header: "Room revenue", numeric: true,
      cell: (d) => d.correctedRevenue == null
        ? moneyOrDash(d.revenuePosted)
        : `${moneyOrDash(d.revenuePosted)} → ${money(d.correctedRevenue)}`,
    },
    { key: "noShows", header: "No-shows", numeric: true, cell: (d) => orDash(d.noShows) },
    {
      key: "correct", header: "",
      cell: (d) => {
        if (!canCorrect) {
          return (d.corrections ?? 0) > 0
            ? <Button size="sm" variant="ghost" onClick={() => open(d.businessDate)}>Corrections</Button>
            : null;
        }
        /* Older than last month (D24-5): off, and the card says why. */
        return (
          <Button size="sm" variant="secondary" disabled={from !== null && d.businessDate < from}
            onClick={() => open(d.businessDate)}>
            Correct
          </Button>
        );
      },
    },
  ];
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
      <p className="text-2xs font-medium text-success-600">
        {label}
        <span className="font-normal text-success-600">
          {" · "}{count} {unit}{count === 1 ? "" : "s"} closed
        </span>
      </p>
      {count === 0 ? (
        <p className="text-2xs text-success-600">Not used today.</p>
      ) : (
        <p className="text-2xs text-success-600 tabular">
          Opened {money(d.opening)} · counted {money(d.counted)}
          {d.variances > 0
            ? ` · ${d.variances} explained variance${d.variances === 1 ? "" : "s"}`
            : ""}
        </p>
      )}
    </div>
  );
}
