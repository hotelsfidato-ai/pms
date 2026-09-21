import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Undo2 } from "lucide-react";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, EmptyState, ErrorState,
  Skeleton, toast,
} from "@/components/ui";
import {
  listSamePerson, listJoins, joinGuests, undoJoin,
  type GuestCard, type SamePersonPair,
} from "@/modules/crm/data/crm";
import { stayedWords } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   POSSIBLE SAME PERSON — the old duplicates, worked through by a manager

   Every booking used to make a new guest record, so a returning guest is
   two or ten records today (root MEMORY 311). This lists every two that
   share a phone or an email, and a manager joins them into one (D21-20).

   The owner's rules, 21 September:
     · only the owner, an administrator or a GM (D21-4)
     · NEVER AUTOMATIC, and every join can be undone (D21-2) - the joins
       below the list are what an undo is pressed on
     · the manager picks which record's name, phone and email stand; a
       blacklist or VIP on either carries over, and comes off on undo
     · if only one record has an ID on file, that record stands, so no ID
       is lost; the ID itself is never shown (the brief, rule 1)
     · two people who share a surname are never a pair: nothing here
       reads a name
   ══════════════════════════════════════════════════════════════════ */

export default function SamePersonPage() {
  const hotelId = useUi((s) => s.hotelId);
  const pairs = useQuery({
    queryKey: ["crm", "same-person", hotelId],
    queryFn: () => listSamePerson(hotelId),
  });
  const joins = useQuery({
    queryKey: ["crm", "joins", hotelId],
    queryFn: () => listJoins(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Possible same person"
        description="Guest records that share a phone number or an email, across every hotel. Join two that are one person; every join can be undone."
        badge={pairs.data
          ? <StatusPill tone="neutral">{pairs.data.length} to look at</StatusPill>
          : undefined}
      />

      <div className="space-y-4">
        {pairs.isLoading && <Skeleton className="h-40" />}
        {pairs.error && <ErrorState error={pairs.error} onRetry={() => void pairs.refetch()} />}
        {pairs.data?.length === 0 && (
          <Card>
            <EmptyState compact icon={<Users />} title="No records share a phone or email"
              description="When two guest records carry the same phone number or email, they are listed here for a manager to judge." />
          </Card>
        )}
        {pairs.data?.map((pair) => (
          <PairCard key={`${pair.a.id}-${pair.b.id}`} hotelId={hotelId} pair={pair} />
        ))}
      </div>

      <h2 className="text-lg font-semibold text-ink-900 mt-10 mb-3">Joined</h2>
      {joins.error && <ErrorState error={joins.error} onRetry={() => void joins.refetch()} />}
      {joins.data?.length === 0 && (
        <p className="text-grey-500">No joins stand. A join made above appears here, with its undo.</p>
      )}
      {!!joins.data?.length && (
        <Card>
          <ul className="divide-y divide-grey-100">
            {joins.data.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 text-base text-ink-900">
                  <span className="font-medium">{j.joinedName}</span> joined into{" "}
                  <Link to={`/crm/guests/${j.keptId}`} className="font-medium underline underline-offset-4">
                    {j.keptName}
                  </Link>
                  <span className="text-grey-500">
                    {" "}· {j.stays} {j.stays === 1 ? "stay" : "stays"} moved · by {j.by ?? "-"} · {dateShort(j.at.slice(0, 10))}
                  </span>
                </span>
                <UndoButton hotelId={hotelId} joinId={j.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}

function PairCard({ hotelId, pair }: { hotelId: string; pair: SamePersonPair }) {
  const qc = useQueryClient();
  /* WHICH ID MAY GO: when exactly one record has one, it stands. */
  const onlyWithId = pair.a.hasId !== pair.b.hasId ? (pair.a.hasId ? pair.a : pair.b) : null;
  const [kept, setKept] = useState<GuestCard | null>(onlyWithId);
  const [busy, setBusy] = useState(false);
  const other = kept ? (kept.id === pair.a.id ? pair.b : pair.a) : null;
  const shared = [pair.samePhone && "phone", pair.sameEmail && "email"].filter(Boolean).join(" and ");

  const join = async () => {
    if (!kept || !other) return;
    setBusy(true);
    const done = await joinGuests(hotelId, kept.id, other.id);
    setBusy(false);
    if (!done.ok) return toast.error("Not joined", done.reason);
    toast.success("Joined", `${other.name}'s stays are now ${kept.name}'s. It can be undone below.`);
    void qc.invalidateQueries({ queryKey: ["crm"] });
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <p className="text-sm text-grey-600">Same {shared}.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {[pair.a, pair.b].map((g) => (
            <Side key={g.id} guest={g}
              chosen={kept?.id === g.id}
              locked={onlyWithId !== null && onlyWithId.id !== g.id}
              onChoose={() => setKept(g)} />
          ))}
        </div>
        {onlyWithId && (
          <p className="text-sm text-grey-600">
            Only {onlyWithId.name} has an ID on file, so that record stands and the ID stays with the guest.
          </p>
        )}
        {kept && other && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-grey-50 border border-grey-200 p-3">
            <span className="min-w-0 flex-1 text-sm text-ink-900">
              {other.name}'s stays move to {kept.name}. Nothing is deleted, and it can be undone.
            </span>
            <Button variant="primary" disabled={busy} onClick={() => void join()}>
              {busy ? "Joining…" : "Join into one"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Side({ guest: g, chosen, locked, onChoose }: {
  guest: GuestCard; chosen: boolean; locked: boolean; onChoose: () => void;
}) {
  return (
    <div className={chosen
      ? "rounded-md border-2 border-brand-orange p-3 space-y-1.5"
      : "rounded-md border border-grey-200 p-3 space-y-1.5"}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/crm/guests/${g.id}`} className="font-medium text-ink-900 underline underline-offset-4">
          {g.name}
        </Link>
        {g.isVip && <StatusPill tone="accent">VIP</StatusPill>}
        {g.isBlacklisted && <StatusPill tone="danger">Blacklisted</StatusPill>}
      </div>
      <p className="text-sm text-grey-600 tabular">{g.phone ?? "-"} · {g.email ?? "-"}</p>
      <p className="text-sm text-grey-600">
        {stayedWords(g.visits)} · last {g.lastStay ? dateShort(g.lastStay) : "-"} ·{" "}
        {g.hasId ? "ID on file" : "no ID on file"}
      </p>
      <Button variant="secondary" disabled={locked || chosen} onClick={onChoose}>
        {chosen ? "This record stands" : "Keep this record"}
      </Button>
    </div>
  );
}

function UndoButton({ hotelId, joinId }: { hotelId: string; joinId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      const done = await undoJoin(hotelId, joinId);
      setBusy(false);
      if (!done.ok) return toast.error("Not undone", done.reason);
      toast.success("Undone", "Every stay is back on the record it came from.");
      void qc.invalidateQueries({ queryKey: ["crm"] });
    }}>
      <Undo2 className="size-4" /> Undo
    </Button>
  );
}
