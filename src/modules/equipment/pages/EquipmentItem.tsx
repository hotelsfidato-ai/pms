import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRightLeft, Pencil, Wrench, CheckCircle2, Archive } from "lucide-react";
import {
  Page, PageHeader, Card, CardHeader, CardBody, DetailList, DetailRow, Button,
  StatusPill, Skeleton, ErrorState, toast,
} from "@/components/ui";
import { useRole, useCurrentHotel } from "@/lib/session";
import { can } from "@/lib/permissions";
import { dateShort, dateTime, money } from "@/lib/format";
import {
  getEquipmentItem, approveRetirement, declineRetirement,
  type EquipmentItem, type HistoryEntry,
} from "@/modules/equipment/data/equipment";
import {
  EditItemDialog, MoveItemDialog, StatusDialog, RetireDialog,
} from "@/modules/equipment/flows/ItemDialogs";
import {
  DASH, STATUS_LABEL, STATUS_TONE, heldText, costText, endsText, whoMay,
} from "@/modules/equipment/words";

/* ══════════════════════════════════════════════════════════════════
   ONE THING IN THE REGISTER

   What it is, where it is, what it cost, and everything that has
   happened to it — newest first, each with who and when. The history
   is written by the database, so this page shows what was recorded,
   not what a screen remembered to send.

   A RETIRED THING STAYS. It is shown with who retired it, when and why,
   and nothing on it can change.
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
  const [deciding, setDeciding] = useState(false);

  const q = useQuery({
    queryKey: ["equipment-item", code, id],
    queryFn: () => getEquipmentItem(code, id),
    enabled: !!code && !!id,
  });

  const done = (landedOn: string) => {
    setDialog(null);
    void qc.invalidateQueries({ queryKey: ["equipment", code] });
    void qc.invalidateQueries({ queryKey: ["equipment-options", code] });
    void qc.invalidateQueries({ queryKey: ["equipment-item", code] });
    /* Part of a count went elsewhere as its own line: that line is what
       the person just acted on, so that is the page they land on. */
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
  const waiting = item.retireRequest !== null;
  const locked = retired || waiting;
  const lockedWhy = retired
    ? "A retired item is kept exactly as it was retired."
    : waiting ? "A retirement is waiting for approval." : null;

  const decide = async (approve: boolean) => {
    setDeciding(true);
    const res = approve
      ? await approveRetirement(code, item.id)
      : await declineRetirement(code, item.id);
    setDeciding(false);
    if (!res.ok) return toast.error(approve ? "Not approved" : "Not declined", res.reason);
    toast.success(approve ? "Retired" : "Retirement declined");
    done(item.id);
  };

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={item.name}
        breadcrumbs={crumbs}
        badge={<StatusPill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusPill>}
        description={`${heldText(item)} · ${item.place}${item.category ? ` · ${item.category}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="h-11" disabled={!mayEdit || locked}
                    onClick={() => setDialog("edit")}>
              <Pencil className="size-4" /> Change details
            </Button>
            <Button variant="secondary" className="h-11" disabled={!mayEdit || locked}
                    onClick={() => setDialog("move")}>
              <ArrowRightLeft className="size-4" /> Move
            </Button>
            <Button variant="secondary" className="h-11" disabled={!mayEdit || locked}
                    onClick={() => setDialog("status")}>
              {item.status === "under_repair"
                ? <><CheckCircle2 className="size-4" /> Back in use</>
                : <><Wrench className="size-4" /> Under repair</>}
            </Button>
            <Button variant="secondary" className="h-11" disabled={!mayEdit || locked}
                    onClick={() => setDialog("retire")}>
              <Archive className="size-4" /> Retire
            </Button>
          </div>
        }
      >
        {(!mayEdit || lockedWhy) && (
          <p className="text-sm text-grey-600 mt-3 leading-relaxed">
            {lockedWhy ?? `Changing, moving and retiring equipment is for the ${whoMay("edit")}.`}
          </p>
        )}
      </PageHeader>

      {waiting && (
        <Card className="border-amber-300 bg-amber-50 mb-4">
          <CardBody>
            <p className="text-base text-ink-900">
              <span className="font-medium">{item.retireRequest!.by ?? "Somebody"}</span> asked to
              retire it on {dateShort(item.retireRequest!.at)}
              {item.retireRequest!.reason ? `: ${item.retireRequest!.reason}` : "."}
            </p>
            {mayApprove ? (
              <div className="flex flex-wrap gap-2 mt-3">
                <Button variant="primary" className="h-11" disabled={deciding}
                        onClick={() => void decide(true)}>Approve — retire it</Button>
                <Button variant="secondary" className="h-11" disabled={deciding}
                        onClick={() => void decide(false)}>Decline</Button>
              </div>
            ) : (
              <p className="text-sm text-grey-600 mt-1.5">
                It waits for the {whoMay("approve")}.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {retired && item.retired && (
        <Card className="mb-4">
          <CardBody>
            <p className="text-base text-ink-900">
              Retired on {dateShort(item.retired.at)} by{" "}
              <span className="font-medium">{item.retired.by ?? DASH}</span>
              {item.retired.requestedBy && item.retired.requestedBy !== item.retired.by
                ? `, asked for by ${item.retired.requestedBy}` : ""}
              {item.retired.reason ? ` — ${item.retired.reason}` : ""}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList>
              <DetailRow label={item.heldAs === "tagged" ? "Tag" : "How many"}>
                <span className="tabular">{heldText(item)}</span>
              </DetailRow>
              <DetailRow label="Where">{item.place}</DetailRow>
              <DetailRow label="Category">{item.category ?? DASH}</DetailRow>
              <DetailRow label="Supplier">{item.supplier ?? DASH}</DetailRow>
              <DetailRow label="Bought on">{item.purchaseDate ? dateShort(item.purchaseDate) : DASH}</DetailRow>
              <DetailRow label="Cost">
                <span className="tabular">{costText(item)}</span>
              </DetailRow>
              <DetailRow label="Warranty ends">{endsText(item.warrantyEnds, today)}</DetailRow>
              <DetailRow label="Service contract ends">{endsText(item.amcEnds, today)}</DetailRow>
              {item.splitFrom && (
                <DetailRow label="Came from">
                  <Link to={`/h/${code}/equipment/${item.splitFrom}`} className="text-brand hover:underline">
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
              <p className="text-base text-grey-600">Nothing is recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-grey-200 pl-3">
                    <p className="text-base text-ink-900">
                      <HistoryLine entry={h} item={item} code={code} />
                    </p>
                    {h.note && h.kind !== "retired" && h.kind !== "retire_requested" && (
                      <p className="text-sm text-grey-600">{h.note}</p>
                    )}
                    <p className="text-sm text-grey-500">
                      {dateTime(h.at)}{h.who ? ` · ${h.who}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      {dialog === "edit" && (
        <EditItemDialog code={code} item={item} open onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done} />
      )}
      {dialog === "move" && (
        <MoveItemDialog code={code} item={item} open onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={done} />
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
      return <>Added{some} in {h.to ?? DASH}, {STATUS_LABEL[h.toStatus ?? "in_use"].toLowerCase()}</>;
    case "split": {
      const other = h.related
        ? <Link to={`/h/${code}/equipment/${h.related.id}`} className="text-brand hover:underline">
            {h.related.id === item.splitFrom ? "the line in " : "their own line, now in "}
            {h.related.place ?? DASH}
          </Link>
        : DASH;
      return h.related?.id === item.splitFrom
        ? <>{h.quantity} taken from {other}</>
        : <>{h.quantity} taken off to {other}</>;
    }
    case "moved":
      return <>Moved{some} from {h.from ?? DASH} to {h.to ?? DASH}</>;
    case "status":
      return h.toStatus === "under_repair" ? <>Marked under repair</> : <>Back in use</>;
    case "retire_requested":
      return <>Asked to retire it{h.note ? `: ${h.note}` : ""}</>;
    case "retire_declined":
      return <>Retirement declined</>;
    case "retired":
      return <>Retired{some}{h.note ? `: ${h.note}` : ""}</>;
    case "edited": {
      const parts = Object.entries(h.changes ?? {}).map(([field, c]) =>
        `${FIELD[field] ?? field} from ${changeValue(field, c.from)} to ${changeValue(field, c.to)}`);
      return <>Changed {parts.join("; ")}</>;
    }
    default:
      return <>{h.kind}</>;
  }
}
