import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { money, relative } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, StatusPill, Skeleton, ErrorState,
  EmptyState, Button, Textarea, Field, fieldProps, toast, Segmented,
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
        /* Waiting or everything: a switch in the title row, the same words
           the tabs had, full width on a phone (the owner, D27-82, as on
           Arrivals). Only the chosen list is drawn. */
        actions={
          <Segmented<"pending" | "all">
            value={tab}
            onChange={setTab}
            className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
            options={[
              { value: "pending", label: "Waiting" },
              { value: "all", label: "Everything" },
            ]}
          />
        }
      />
      {q.isPending && <Skeleton className="h-40" />}
      {/* The states sit in a card, as a list's own states do. */}
      {q.isError && <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>}
      {q.data && q.data.rows.length === 0 && (
        <Card><EmptyState
          icon={<CheckCircle2 />}
          title={tab === "pending" ? "Nothing is waiting on you" : "Nothing has been asked for yet"}
          description={tab === "pending"
            ? "When somebody raises a purchase request or asks to take equipment out of the store, it appears here."
            : "Decided requests stay here so you can see what was approved and by whom."}
        /></Card>
      )}
      {q.data?.rows.map((a) => (
        <Row key={a.id} approval={a} code={code!} onDone={() => q.refetch()} />
      ))}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* It opens the request on its own screen, so it reads as a link
              (the Tappable Rule): orange, underlined on hover. */}
          <div className="text-md font-semibold text-ink-900">
            {where ? <Link to={where} className="text-brand-orange-700 hover:underline underline-offset-4">{labelFor(a.kind)}</Link>
                   : labelFor(a.kind)}
          </div>
          <StatusPill tone={a.status === "pending" ? "warning"
                          : a.status === "approved" ? "success" : "danger"}>
            {/* In words (the owner, D27-82); "clarify", the engine's one
                other state, has no word decided yet and shows as it is. */}
            {a.status === "pending" ? "Waiting"
              : a.status === "approved" ? "Approved"
              : a.status === "rejected" ? "Refused"
              : a.status}
          </StatusPill>
        </div>

        <p className="mt-1 text-sm text-grey-700">{a.reason}</p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-grey-500">
          {/* NO INVENTED FIGURE. A stock adjustment has no amount, and a
              dash is honest where a zero would be a claim. */}
          {a.amount !== null && <span className="font-medium text-grey-700 tabular">{money(Number(a.amount))}</span>}
          <span>Asked by {a.requestedBy ?? "-"}</span>
          <span>{relative(a.requestedAt)}</span>
        </div>

        {a.status !== "pending" && (
          <p className="mt-2 text-sm text-grey-500">
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
    return <p className="mt-3 pt-3 border-t border-grey-100 text-sm text-grey-500">{a.blockedBecause ?? "This one is not yours to decide."}</p>;
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
    <div className="mt-3 border-t border-grey-100 pt-3">
      <Field label="A note (required to refuse)">
        {(f) => <Textarea {...fieldProps(f)} value={note} rows={2}
                          placeholder="Why, in a sentence."
                          onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => send("approved")} disabled={busy}>Approve</Button>
        <Button variant="secondary" onClick={() => send("rejected")} disabled={busy}>Refuse</Button>
      </div>
    </div>
  );
}
