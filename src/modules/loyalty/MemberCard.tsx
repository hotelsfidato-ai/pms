import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dateShort, number } from "@/lib/format";
import { Card, CardBody, CardHeader, Button, Field, Input, ErrorState, Skeleton, toast } from "@/components/ui";
import { getCard, adjustPoints, leaveLoyalty, type StatementLine } from "@/modules/loyalty/data/loyalty";

/* THE MEMBER CARD on Guest 360 (D27-179, L6): the owner, an administrator
   and the GM see a member's points and every line of their statement, at
   every hotel, and may add or take points with a reason, or take them out
   of the programme (L5). Joining is the desk's, on the Loyalty screen. */

const WHAT: Record<StatementLine["kind"], string> = {
  earn: "Earned", redeem: "Used", adjust: "Adjusted", lapse: "Lapsed",
};

export function MemberCard({ hotelId, guestId }: { hotelId: string; guestId: string }) {
  const qc = useQueryClient();
  const card = useQuery({ queryKey: ["loyalty", "card", hotelId, guestId], queryFn: () => getCard(hotelId, guestId) });
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const act = async (result: Promise<{ ok: true } | { ok: false; reason: string }>, said: string) => {
    setBusy(true);
    const r = await result;
    setBusy(false);
    if (!r.ok) return toast.error("Not done", r.reason);
    toast.success(said);
    setPoints(""); setReason("");
    void qc.invalidateQueries({ queryKey: ["loyalty"] });
  };

  if (card.isLoading) return <Card><CardHeader title="Loyalty" /><CardBody><Skeleton className="h-16" /></CardBody></Card>;
  if (card.error || !card.data) {
    return <Card><CardHeader title="Loyalty" /><ErrorState error={card.error} onRetry={() => void card.refetch()} /></Card>;
  }
  const c = card.data;
  const n = Number(points);

  return (
    <Card>
      <CardHeader title="Loyalty"
        description={c.member ? `Member since ${dateShort(c.member.since.slice(0, 10))}, joined at ${c.member.hotelName}`
          : "Not a member. The desk joins a guest on the Loyalty screen, with their yes."}
        actions={c.member && <span className="text-lg font-semibold tabular text-ink-900">{number(c.points)} points</span>} />
      <CardBody className="space-y-4">
        {c.statement.length === 0 ? (
          <p className="text-sm text-grey-500">No points yet.</p>
        ) : (
          <ul className="-my-3.5 divide-y divide-grey-100">
            {c.statement.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-3 text-sm">
                <span className="tabular text-grey-600">{dateShort(l.at.slice(0, 10))}</span>
                <span className="min-w-0 flex-1 text-ink-900">
                  {WHAT[l.kind]}{l.reference ? ` on ${l.reference}` : ""} at {l.hotelName}
                  {l.reason ? ` - ${l.reason}` : ""}{l.undone ? " (taken off the bill again; points back)" : ""}
                </span>
                <span className={`tabular font-medium ${l.undone ? "text-grey-400 line-through" : "text-ink-900"}`}>
                  {l.points > 0 ? "+" : ""}{number(l.points)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {c.member && (
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end border-t border-grey-100 pt-4">
            <Field label="Points" hint="Minus to take">
              {({ id }) => <Input id={id} inputMode="numeric" value={points}
                onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ""))} />}
            </Field>
            <Field label="Reason" hint="Stays on the statement">
              {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy || !Number.isInteger(n) || n === 0 || !reason.trim()}
                onClick={() => void act(adjustPoints(hotelId, guestId, n, reason), "Points adjusted")}>Adjust</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setLeaving(true)}>Leave</Button>
            </div>
          </div>
        )}
        {c.member && leaving && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-grey-50 px-3.5 py-3">
            <p className="min-w-0 flex-1 text-sm text-ink-900">
              Their {number(c.points)} points lapse. Their history stays with the bills.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setLeaving(false)}>Cancel</Button>
            <Button variant="danger" size="sm" disabled={busy}
              onClick={() => void act(leaveLoyalty(hotelId, guestId), "Left the programme").then(() => setLeaving(false))}>
              Leave loyalty
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
