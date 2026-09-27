import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRightLeft, Pencil, Wrench, CheckCircle2, Archive, Clock } from "lucide-react";
import {
  Page, PageHeader, Card, CardHeader, CardBody, DetailList, DetailRow, Button,
  StatusPill, Skeleton, ErrorState, IconChip,
} from "@/components/ui";
import { useRole, useCurrentHotel } from "@/lib/session";
import { can } from "@/lib/permissions";
import { dateShort, dateTime, money } from "@/lib/format";
import {
  getEquipmentItem, listEquipmentApprovals,
  type EquipmentItem, type HistoryEntry,
} from "@/modules/equipment/data/equipment";
import {
  EditItemDialog, MoveItemDialog, StatusDialog, RetireDialog,
} from "@/modules/equipment/flows/ItemDialogs";
import { DecideButtons } from "@/modules/equipment/flows/Decide";
import { ItemRepairs } from "@/modules/housekeeping";
import {
  DASH, STATUS_LABEL, STATUS_TONE, heldText, costText, endsText, whoMay,
} from "@/modules/equipment/words";

/* ══════════════════════════════════════════════════════════════════
   ONE THING IN THE REGISTER

   What it is, where it is, what it cost, and everything that has
   happened to it — newest first, each with who and when. Names are shown
   to whoever may approve; anybody else sees a dash (the owner's answer).

   WAITING. A request to take it out of the store, or to retire it, waits
   in the ONE approvals inbox (S12–S16). It is shown here beside the thing
   it is about, with Approve and Refuse only for somebody the inbox says
   may decide — the decision goes to the core endpoint. Refused, the reason
   stays beside it.

   A RETIRED THING STAYS, with who retired it, when and why, and nothing
   on it can change.
   ══════════════════════════════════════════════════════════════════ */

type Open = "edit" | "move" | "status" | "retire" | null;

export default function EquipmentItemPage() {
  const { code = "", id = "" } = useParams<{ code: string; id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useRole();
  const today = useCurrentHotel()?.businessDate;

  const mayEdit = can(role, "edit", "equipment");
  const mayApprove = can(role, "approve", "equipment");

  const [dialog, setDialog] = useState<Open>(null);

  const q = useQuery({
    queryKey: ["equipment-item", code, id],
    queryFn: () => getEquipmentItem(code, id),
    enabled: !!code && !!id,
  });
  const inbox = useQuery({
    queryKey: ["equipment-approvals", code],
    queryFn: () => listEquipmentApprovals(code),
    enabled: !!code,
  });

  const done = (landedOn: string) => {
    setDialog(null);
    for (const key of ["equipment", "equipment-options", "equipment-item", "equipment-approvals"]) {
      void qc.invalidateQueries({ queryKey: [key, code] });
    }
    /* Part of a count went elsewhere as its own line: that line is what the
       person just acted on, so that is the page they land on. */
    if (landedOn !== id) navigate(`/h/${code}/equipment/${landedOn}`);
  };

  const crumbs = [{ label: "Equipment", to: `/h/${code}/equipment` }];

  if (q.isLoading) {
    return (
      <Page className="max-w-4xl">
        <PageHeader title="Equipment" breadcrumbs={crumbs} />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  if (q.error || !q.data) {
    return (
      <Page className="max-w-4xl">
        <PageHeader title="Equipment" breadcrumbs={crumbs} />
        <Card>
          <ErrorState title="This item could not be opened" error={q.error}
                      onRetry={() => void q.refetch()} />
        </Card>
      </Page>
    );
  }

  const { item, history } = q.data;
  const retired = item.status === "retired";
  const waiting = item.leaving !== null || item.retireRequest !== null;
  const locked = retired || waiting;
  const lockedWhy = retired
    ? "A retired item is kept exactly as it was retired."
    : waiting ? "A request for it is waiting in the approvals inbox. It is decided there first." : null;
  const fromStore = item.placeKind === "store";
  /* Anybody who can see it may ASK for it to leave the store (S15); moving it
     otherwise is for those who may edit. */
  const mayMove = mayEdit || fromStore;
  const approvalFor = (approvalId: string | undefined) =>
    inbox.data?.find((a) => a.id === approvalId);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={item.name}
        breadcrumbs={crumbs}
        badge={<StatusPill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusPill>}
        description={`${heldText(item)} · ${item.place}${fromStore ? " (a store)" : ""}${item.category ? ` · ${item.category}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!mayEdit || locked}
                    onClick={() => setDialog("edit")}>
              <Pencil className="size-4" /> Change details
            </Button>
            <Button variant="secondary" disabled={!mayMove || locked}
                    onClick={() => setDialog("move")}>
              <ArrowRightLeft className="size-4" /> {fromStore && !mayEdit ? "Ask to take out" : "Move"}
            </Button>
            <Button variant="secondary" disabled={!mayEdit || locked}
                    onClick={() => setDialog("status")}>
              {item.status === "under_repair"
                ? <><CheckCircle2 className="size-4" /> Back in use</>
                : <><Wrench className="size-4" /> Under repair</>}
            </Button>
            <Button variant="secondary" disabled={!mayEdit || locked}
                    onClick={() => setDialog("retire")}>
              <Archive className="size-4" /> Retire
            </Button>
          </div>
        }
      >
        {(lockedWhy || !mayEdit) && (
          <p className="text-sm text-grey-600 leading-relaxed">
            {lockedWhy ?? (
              `Changing, moving and retiring equipment is for the ${whoMay("edit")}.`
              + (fromStore ? " Anybody who can see it may ask for it to leave the store." : "")
            )}
          </p>
        )}
      </PageHeader>

      {/* The notes about the item: 12px apart, 20px over the details, and
          gone with their gap when there are none (`empty:`). A request that
          waits is something to do, so its tile is the warm one. */}
      <div className="space-y-3 mb-5 empty:hidden">
        {item.leaving && (
          <div className="rounded-lg bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 px-4 py-3.5">
            <p className="text-sm text-ink-900 flex items-start gap-2.5">
              <IconChip tone="yellow" className="-mt-1"><Clock /></IconChip>
              <span>
                <span className="font-medium">Waiting to leave the store</span> for{" "}
                {item.leaving.to ?? DASH} - asked by {item.leaving.by ?? DASH} on{" "}
                {dateShort(item.leaving.at)}
                {item.leaving.reason ? `: ${item.leaving.reason}` : "."}
              </span>
            </p>
            {!approvalFor(item.leaving.approvalId) && !inbox.isLoading && (
              <p className="text-sm text-grey-600 mt-1.5">It waits for the {whoMay("approve")}.</p>
            )}
            <DecideButtons code={code} approval={approvalFor(item.leaving.approvalId)}
                           approveLabel="Approve - let it go" onDone={() => done(item.id)} />
          </div>
        )}

        {item.leavingRefused && !item.leaving && (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-900">
                <span className="font-medium">
                  {item.leavingRefused.sentBack ? "Sent back" : "Refused"}
                </span>{" "}
                - taking it to {item.leavingRefused.to ?? DASH}
                {item.leavingRefused.at ? ` (${dateShort(item.leavingRefused.at)})` : ""}
                {item.leavingRefused.note ? `: ${item.leavingRefused.note}` : "."} It is still here.
              </p>
            </CardBody>
          </Card>
        )}

        {item.retireRequest && (
          <div className="rounded-lg bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 px-4 py-3.5">
            <p className="text-sm text-ink-900 flex items-start gap-2.5">
              <IconChip tone="yellow" className="-mt-1"><Clock /></IconChip>
              <span>
                <span className="font-medium">Retirement waiting</span> - asked by{" "}
                {item.retireRequest.by ?? DASH} on {dateShort(item.retireRequest.at)}
                {item.retireRequest.reason ? `: ${item.retireRequest.reason}` : "."}
              </span>
            </p>
            {!approvalFor(item.retireRequest.approvalId) && !inbox.isLoading && (
              <p className="text-sm text-grey-600 mt-1.5">It waits for the {whoMay("approve")}.</p>
            )}
            <DecideButtons code={code} approval={approvalFor(item.retireRequest.approvalId)}
                           approveLabel="Approve - retire it" onDone={() => done(item.id)} />
          </div>
        )}

        {item.retireRefused && !item.retireRequest && !retired && (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-900">
                <span className="font-medium">
                  Retirement {item.retireRefused.sentBack ? "sent back" : "refused"}
                </span>
                {item.retireRefused.at ? ` (${dateShort(item.retireRefused.at)})` : ""}
                {item.retireRefused.note ? `: ${item.retireRefused.note}` : "."}
              </p>
            </CardBody>
          </Card>
        )}

        {retired && item.retired && (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-900">
                Retired on {dateShort(item.retired.at)} by{" "}
                <span className="font-medium">{item.retired.by ?? DASH}</span>
                {item.retired.requestedBy ? `, asked for by ${item.retired.requestedBy}` : ""}
                {item.retired.reason ? ` - ${item.retired.reason}` : ""}
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Each card as tall as what it holds (the No Dead Space Rule): the
          two sit side by side without being stretched to match. mb-5 so the
          repairs card below sits 20px off, whatever its own margin. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start mb-5">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList>
              <DetailRow label={item.heldAs === "tagged" ? "Tag" : "How many"}>
                <span className="tabular">{heldText(item)}</span>
              </DetailRow>
              <DetailRow label="Where">{item.place}{fromStore ? " (a store)" : ""}</DetailRow>
              <DetailRow label="Category">{item.category ?? DASH}</DetailRow>
              <DetailRow label="Supplier">{item.supplier ?? DASH}</DetailRow>
              <DetailRow label="Bought on">{item.purchaseDate ? dateShort(item.purchaseDate) : DASH}</DetailRow>
              <DetailRow label="Cost"><span className="tabular">{costText(item)}</span></DetailRow>
              <DetailRow label="Warranty ends">{endsText(item.warrantyEnds, today)}</DetailRow>
              <DetailRow label="Service contract ends">{endsText(item.amcEnds, today)}</DetailRow>
              {item.splitFrom && (
                <DetailRow label="Came from">
                  <Link to={`/h/${code}/equipment/${item.splitFrom}`} className="text-brand-orange-700 hover:underline underline-offset-4">
                    the line it was taken from
                  </Link>
                </DetailRow>
              )}
            </DetailList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What has happened to it" />
          <CardBody>
            {history.length === 0 ? (
              <p className="text-sm text-grey-600">Nothing is recorded yet.</p>
            ) : (
              /* List rows with a hairline between (the Rhythm Rule). */
              <ol className="divide-y divide-grey-100">
                {history.map((h) => (
                  <li key={h.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm text-ink-900">
                      <HistoryLine entry={h} item={item} code={code} />
                    </p>
                    {h.note && !["retired", "retire_asked"].includes(h.kind) && (
                      <p className="text-sm text-grey-600 mt-0.5">{h.note}</p>
                    )}
                    <p className="text-xs text-grey-500 mt-0.5">
                      {dateTime(h.at)} · {h.who ?? DASH}
                    </p>
                    <DecisionLine entry={h} />
                  </li>
                ))}
              </ol>
            )}
            {!mayApprove && (
              <p className="text-xs text-grey-500 mt-3 pt-3 border-t border-grey-100">
                Who did what is shown to the {whoMay("approve")}.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* REPAIRS — housekeeping's, through its front door (phase 2B, the
          owner's answer of 17 September). Added by the housekeeping chat,
          for the master to review at merge. */}
      <ItemRepairs
        hotelId={code}
        item={{
          id: item.id, name: item.name, tag: item.tag, heldAs: item.heldAs,
          roomNumber: item.roomId ? item.place.replace(/^Room /, "") : null,
          retired,
        }}
      />

      {dialog === "edit" && (
        <EditItemDialog code={code} item={item} open onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done} />
      )}
      {dialog === "move" && (
        <MoveItemDialog code={code} item={item} mayEdit={mayEdit} open
                        onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done} />
      )}
      {dialog === "status" && (
        <StatusDialog code={code} item={item} open onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done} />
      )}
      {dialog === "retire" && (
        <RetireDialog code={code} item={item} open onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done}
                      waitsForApproval={item.heldAs === "tagged" && !mayApprove} />
      )}
    </Page>
  );
}

/* ── One line of the history, in words ────────────────────────────── */

const FIELD: Record<string, string> = {
  name: "name", category: "category", supplier: "supplier", tag: "tag",
  purchaseDate: "bought on", unitCost: "cost", warrantyEnds: "warranty end",
  amcEnds: "service contract end",
};

function changeValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return DASH;
  if (field === "unitCost") return money(Number(v));
  if (field === "purchaseDate" || field === "warrantyEnds" || field === "amcEnds") return dateShort(String(v));
  return String(v);
}

function HistoryLine({ entry: h, item, code }: { entry: HistoryEntry; item: EquipmentItem; code: string }) {
  const some = item.heldAs === "counted" ? ` ${h.quantity}` : "";
  switch (h.kind) {
    case "added":
      return <>Added{some} in {h.place ?? DASH}, {STATUS_LABEL[h.toStatus ?? "in_use"].toLowerCase()}</>;
    case "split": {
      const cameFrom = h.related?.id === item.splitFrom;
      const other = h.related
        ? <Link to={`/h/${code}/equipment/${h.related.id}`} className="text-brand-orange-700 hover:underline underline-offset-4">
            {cameFrom ? "the line in " : "their own line, now in "}{h.related.place ?? DASH}
          </Link>
        : DASH;
      return cameFrom ? <>{h.quantity} taken from {other}</> : <>{h.quantity} taken off to {other}</>;
    }
    case "moved":
      return <>Moved{some} from {h.from ?? DASH} to {h.to ?? DASH}</>;
    case "move_asked":
      return <>Asked to take{some} out of {h.from ?? DASH} to {h.to ?? DASH}</>;
    case "status":
      return h.toStatus === "under_repair" ? <>Marked under repair</> : <>Back in use</>;
    case "retired":
      return <>Retired{some}{h.note ? `: ${h.note}` : ""}</>;
    case "retire_asked":
      return <>Asked to retire it{h.note ? `: ${h.note}` : ""}</>;
    case "edited": {
      const parts = Object.entries(h.changes ?? {}).map(([field, c]) =>
        `${FIELD[field] ?? field} from ${changeValue(field, c.from)} to ${changeValue(field, c.to)}`);
      return <>Changed {parts.join("; ")}</>;
    }
    default:
      return <>{h.kind}</>;
  }
}

/** What became of a request: waiting, approved, refused or sent back. */
function DecisionLine({ entry: h }: { entry: HistoryEntry }) {
  const d = h.decision;
  if (!d) return null;
  if (d.status === "pending") {
    return <p className="text-sm text-brand-yellow-800">Waiting in the approvals inbox</p>;
  }
  const word = d.status === "approved" ? "Approved" : d.status === "rejected" ? "Refused" : "Sent back";
  return (
    <p className="text-sm text-grey-600">
      {word}{d.at ? ` ${dateTime(d.at)}` : ""} · {d.by ?? DASH}{d.note ? ` - ${d.note}` : ""}
    </p>
  );
}
