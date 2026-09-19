import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { money, relative } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, StatusPill, Skeleton, ErrorState,
  EmptyState, Button, Textarea, Field, fieldProps, toast, Tabs, TabsList,
  TabsTrigger, TabsContent,
} from "@/components/ui";
import { listApprovals, decide, labelFor, whereFor, type Approval } from "@/data/repositories/approvals";
import { useUi } from "@/lib/ui";

/* ══════════════════════════════════════════════════════════════════
   ONE PLACE TO SEE EVERYTHING WAITING ON YOU — the owner's D18-19

   The approvals ENGINE has been one since migration 076 and every
   service decides through it. What did not exist was this screen: a GM
   with a purchase request, two equipment gate passes and a stock
   adjustment waiting had to know to open four different screens.

   ⚠ IT ADDS NO SECOND WAY TO DECIDE. Every button here posts to the
   same core endpoint the equipment register and the purchase request
   post to, and the server refuses anybody who may not decide and the
   person who asked — so this screen and the server cannot disagree
   (Rule 6). `mayDecide` and `blockedBecause` are the server's words,
   not this screen's guess.

   The service screens keep their own buttons. This is a second VIEW,
   not a second engine.
   ══════════════════════════════════════════════════════════════════ */

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

export default function ApprovalsPage() {
  const code = useHotel();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const q = useQuery({
    queryKey: ["approvals", code, tab],
    queryFn: () => listApprovals(code!, tab),
    enabled: Boolean(code),
  });

  return (
    <Page>
      <PageHeader
        title="Approvals"
        description="Everything waiting on you, from every part of the system."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "all")}>
        <TabsList>
          <TabsTrigger value="pending">Waiting</TabsTrigger>
          <TabsTrigger value="all">Everything</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {q.isPending && <Skeleton className="h-40" />}
          {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {q.data && q.data.rows.length === 0 && (
            <EmptyState
              icon={<CheckCircle2 />}
              title={tab === "pending" ? "Nothing is waiting on you" : "Nothing has been asked for yet"}
              description={tab === "pending"
                ? "When somebody raises a purchase request or asks to take equipment out of the store, it appears here."
                : "Decided requests stay here so you can see what was approved and by whom."}
            />
          )}
          {q.data?.rows.map((a) => (
            <Row key={a.id} approval={a} code={code!} onDone={() => q.refetch()} />
          ))}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function Row({ approval: a, code, onDone }: {
  approval: Approval; code: string; onDone: () => void;
}) {
  const where = whereFor(a, code);
  return (
    <Card className="mb-3">
      <CardBody>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-medium">
            {where ? <Link to={where} className="hover:underline">{labelFor(a.kind)}</Link>
                   : labelFor(a.kind)}
          </div>
          <StatusPill tone={a.status === "pending" ? "warning"
                          : a.status === "approved" ? "success" : "danger"}>
            {a.status === "pending" ? "Waiting" : a.status}
          </StatusPill>
        </div>

        <p className="mt-1 text-sm text-ink-600">{a.reason}</p>

        <div className="mt-2 text-sm text-ink-500">
          {/* NO INVENTED FIGURE. A stock adjustment has no amount, and a
              dash is honest where a zero would be a claim. */}
          {a.amount !== null && <span className="mr-4">{money(Number(a.amount))}</span>}
          <span className="mr-4">Asked by {a.requestedBy ?? "-"}</span>
          <span>{relative(a.requestedAt)}</span>
        </div>

        {a.status !== "pending" && (
          <p className="mt-2 text-sm text-ink-500">
            {a.status === "approved" ? "Approved" : "Refused"} by {a.decidedBy ?? "-"}
            {a.decisionNote ? ` — ${a.decisionNote}` : ""}
          </p>
        )}

        {a.status === "pending" && <Decide approval={a} code={code} onDone={onDone} />}
      </CardBody>
    </Card>
  );
}

/* THE SAME SHAPE EQUIPMENT AND PURCHASING USE. The buttons are offered
   only where the server's queue says `mayDecide`; anywhere else its
   `blockedBecause` is the sentence, because a person who cannot act
   needs to know why and not just find a missing button. */
function Decide({ approval: a, code, onDone }: {
  approval: Approval; code: string; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  if (!a.mayDecide) {
    return <p className="mt-3 text-sm text-ink-500">{a.blockedBecause ?? "This one is not yours to decide."}</p>;
  }

  const send = async (decision: "approved" | "rejected") => {
    /* A refusal needs a reason: the person who asked has to know what to
       do next. Approving does not. */
    if (decision === "rejected" && !note.trim()) {
      toast.error("Say why it is refused, so the person who asked knows what to do next.");
      return;
    }
    setBusy(true);
    const out = await decide(code, a.id, decision, note.trim() || undefined);
    setBusy(false);
    if (!out.ok) { toast.error(out.reason); return; }
    toast.success(decision === "approved" ? "Approved." : "Refused, and they have been told why.");
    await qc.invalidateQueries({ queryKey: ["approvals"] });
    onDone();
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <Field label="A note (required to refuse)">
        {(f) => <Textarea {...fieldProps(f)} value={note} rows={2}
                          placeholder="Why, in a sentence."
                          onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => send("approved")} disabled={busy}>Approve</Button>
        <Button variant="secondary" onClick={() => send("rejected")} disabled={busy}>Refuse</Button>
      </div>
    </div>
  );
}
