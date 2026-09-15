import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Page, PageHeader, Card, DataTable, type Column } from "@/components/ui";
import { listRoomTypes, listRatePlans, type RoomTypeRecord, type RatePlanRecord } from "@/modules/inventory/data/unroutedLists";
import { useParams } from "react-router";
import { useUi } from "@/lib/ui";
import { money } from "@/lib/format";

/* Split out of Directory.tsx on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Service: inventory. Unchanged. */

/* ⚠ ROUTED NOWHERE. App.tsx sends /h/:code/room-types to RoomSetupPage and
   /h/:code/rate-plans to RatePlansEditor; these two older screens are
   reachable by no address. Kept, not deleted, pending the owner
   (PENDING.md). */

/* The property in view: the URL's, or the one last chosen. The same five
   lines as Guests.tsx — kept beside each screen that uses them. */
function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Room types ──────────────────────────────────────────────────── */

const TYPE_COLUMNS: Column<RoomTypeRecord>[] = [
  { key: "type", header: "Room type", cell: (t) => <span className="font-medium">{t.type}</span> },
  { key: "rooms", header: "Rooms", numeric: true, cell: (t) => <span className="tabular">{t.rooms}</span> },
  {
    key: "sellable", header: "Sellable", numeric: true,
    cell: (t) => (
      <span className={cn("tabular", t.sellable < t.rooms && "text-brand-yellow font-medium")}>
        {t.sellable}
      </span>
    ),
  },
  { key: "occ", header: "Max occupancy", numeric: true, hideBelow: "sm", cell: (t) => <span className="tabular">{t.maxOccupancy}</span> },
  { key: "rack", header: "Rack rate", numeric: true, cell: (t) => <span className="tabular">{money(t.rackRate)}</span> },
  {
    key: "numbers", header: "Room numbers", hideBelow: "lg",
    cell: (t) => <span className="tabular text-grey-600 text-sm">{t.numbers.join(", ")}</span>,
  },
];

export function RoomTypesPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["room-types", hotelId],
    queryFn: () => listRoomTypes(hotelId),
  });

  const held = (data ?? []).reduce((t, r) => t + (r.rooms - r.sellable), 0);

  return (
    <Page>
      <PageHeader
        title="Room types"
        description="What the property sells, and how much of it is actually sellable today."
      />
      <Card>
        <DataTable<RoomTypeRecord>
          rows={data ?? []}
          columns={TYPE_COLUMNS}
          rowKey={(t) => t.type}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      {held > 0 && (
        <p className="text-xs text-grey-500 mt-4 leading-relaxed">
          {held} room{held === 1 ? " is" : "s are"} held out of service, which is why
          the sellable house is smaller than the physical one. Occupancy divides by the
          sellable count, never the physical one.
        </p>
      )}
    </Page>
  );
}

/* ── Rate plans ──────────────────────────────────────────────────── */

const PLAN_COLUMNS: Column<RatePlanRecord>[] = [
  { key: "code", header: "Code", width: "w-[110px]", cell: (p) => <span className="tabular font-medium">{p.code}</span> },
  { key: "name", header: "Plan", cell: (p) => p.name },
  { key: "includes", header: "Includes", cell: (p) => <span className="text-grey-600">{p.includes}</span> },
  {
    key: "seen", header: "In the live system", hideBelow: "md",
    cell: (p) => p.seenAs ? <span className="tabular text-grey-600">{p.seenAs}</span> : <span className="text-grey-400">—</span>,
  },
];

export function RatePlansPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["rate-plans"], queryFn: listRatePlans });

  return (
    <Page>
      <PageHeader
        title="Rate plans"
        description="What a rate includes. Taken from the plans the live system actually uses."
      />
      <Card>
        <DataTable<RatePlanRecord>
          rows={data ?? []}
          columns={PLAN_COLUMNS}
          rowKey={(p) => p.code}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        The live Night Audit shows plans as <span className="tabular">Deluxe CP</span> —
        room type and meal plan together. A published rate calendar arrives at Stage 9;
        until then the rack rate is what a room type carries.
      </p>
    </Page>
  );
}
