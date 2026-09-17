import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { useRole } from "@/lib/session";
import { money, dateShort } from "@/lib/format";
import {
  Button, Card, CardBody, CardHeader, ErrorState, Skeleton, StatusPill,
} from "@/components/ui";
import { listRepairsForItem, type WorkOrder } from "@/modules/housekeeping/data/housekeeping";
import { RepairFlow } from "@/modules/housekeeping/flows/RepairFlow";
import { RepairCosts } from "@/modules/housekeeping/flows/RepairCosts";
import { reportsRepairs } from "@/modules/housekeeping/repairRoles";

/* ══════════════════════════════════════════════════════════════════
   A PIECE OF EQUIPMENT'S REPAIRS — shown on its own page

   Phase 2B: "the item's repair history". The owner, 17 September: on the
   item's page, where kitchen and reception — who have no Work orders menu
   — report a repair too. Housekeeping's, because repairs are; exported
   through `src/modules/housekeeping/index.ts` for the equipment page.

   Money only where the list sent it: the five who record costs and the
   accountant (the owner, 17 September).
   ══════════════════════════════════════════════════════════════════ */

export interface ItemRepairsProps {
  hotelId: string;
  item: {
    id: string; name: string; tag: string | null; heldAs: "tagged" | "counted";
    roomNumber: string | null; retired: boolean;
  };
}

export function ItemRepairs({ hotelId, item }: ItemRepairsProps) {
  const role = useRole();
  const [reporting, setReporting] = useState(false);
  const [costing, setCosting] = useState<string | null>(null);

  const repairs = useQuery({
    queryKey: ["item-repairs", hotelId, item.id],
    queryFn: () => listRepairsForItem(hotelId, item.id),
  });

  const orders = repairs.data?.orders ?? [];
  const costOpen = orders.find((o) => o.id === costing) ?? null;
  const seesMoney = repairs.data?.maySeeCosts ?? false;
  const totals = orders.map((o) => o.costTotal).filter((t): t is number => t != null);
  const total = totals.length ? Math.round(totals.reduce((s, t) => s + t, 0) * 100) / 100 : null;

  /* Only a tagged thing is repaired (the owner, 17 September), and a
     retired one is kept as it was retired. */
  const why = item.retired ? "A retired item is kept exactly as it was retired."
    : item.heldAs !== "tagged" ? "A counted line is retired or replaced, not repaired."
    : !reportsRepairs(role) ? "Reporting a repair is for the people who work with the equipment - not the accountant or a viewer."
    : null;

  return (
    <Card className="mt-4" data-item-repairs>
      <CardHeader
        title="Repairs"
        description={seesMoney
          ? `Every repair on it, open and closed. Cost recorded: ${total == null ? "-" : money(total)}.`
          : "Every repair on it, open and closed."}
        actions={
          <Button variant="secondary" className="h-11" disabled={why !== null}
                  onClick={() => setReporting(true)}>
            <Plus className="size-4" /> Report a repair
          </Button>
        }
      />
      <CardBody>
        {why && <p className="text-sm text-grey-600 mb-3">{why}</p>}
        {repairs.isLoading ? (
          <Skeleton className="h-20" />
        ) : repairs.error ? (
          <ErrorState title="Its repairs did not load" error={repairs.error}
                      onRetry={() => void repairs.refetch()} />
        ) : orders.length === 0 ? (
          <p className="text-base text-grey-600">No repair has been recorded on it.</p>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => <RepairLine key={o.id} order={o} onCosts={() => setCosting(o.id)} />)}
          </ul>
        )}
      </CardBody>

      {item.tag && (
        <RepairFlow
          hotelId={hotelId}
          open={reporting}
          onOpenChange={setReporting}
          title={`Report a repair · ${item.name}`}
          description="It shows as under repair until the repair is closed."
          item={{ id: item.id, name: item.name, tag: item.tag, roomNumber: item.roomNumber }}
        />
      )}
      {costOpen && (
        <RepairCosts
          hotelId={hotelId}
          order={costOpen}
          mayRecord={repairs.data?.mayRecordCosts ?? false}
          open
          onOpenChange={(open) => { if (!open) setCosting(null); }}
        />
      )}
    </Card>
  );
}

function RepairLine({ order: o, onCosts }: { order: WorkOrder; onCosts: () => void }) {
  const closed = o.status === "done" || o.status === "cancelled";
  return (
    <li className="border-l-2 border-grey-200 pl-3" data-item-repair={o.id}>
      <p className="flex flex-wrap items-center gap-2 text-base text-ink-900">
        {o.title}
        {o.status === "done" ? <StatusPill tone="success">Fixed</StatusPill>
          : o.status === "cancelled" ? <StatusPill tone="neutral">Not needed</StatusPill>
          : o.status === "in_progress" ? <StatusPill tone="info">Being fixed</StatusPill>
          : <StatusPill tone="warning">Open</StatusPill>}
      </p>
      {closed && o.resolution && <p className="text-sm text-grey-600">{o.resolution}</p>}
      <p className="text-sm text-grey-500">
        Raised {dateShort(o.raisedAt)}{o.raisedBy ? ` by ${o.raisedBy}` : ""}
        {closed ? ` · closed ${dateShort(o.closedAt)}${o.closedBy ? ` by ${o.closedBy}` : ""}` : ""}
      </p>
      {o.costs !== undefined && (
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <span className="text-sm text-ink-900 tabular">
            Cost {o.costTotal == null ? "-" : money(o.costTotal)}
          </span>
          <Button variant="ghost" className="h-11" onClick={onCosts}>
            <Receipt className="size-4" /> Costs
          </Button>
        </div>
      )}
    </li>
  );
}
