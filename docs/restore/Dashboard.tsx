import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import {
  Page, PageHeader, Card, CardBody, DataTable, Skeleton, type Column,
} from "@/components/ui";
import { money } from "@/lib/format";
import {
  listProperties, getPeriodStatistics, listArrivals, getStayViewCounts,
  BUSINESS_DATE, type Property,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   GROUP DASHBOARD — `/`

   One row per property. An owner reads this; a clerk does not — they
   live in the tape chart. Exactly one hero accent on the page, using
   the logo gradient, and only one.
   ══════════════════════════════════════════════════════════════════ */

interface Row {
  property: Property;
  occupancyPct: number;
  adr: number;
  revpar: number;
  arrivals: number;
  dirty: number;
}

async function buildRows(): Promise<Row[]> {
  const properties = await listProperties();
  return Promise.all(
    properties.map(async (property) => {
      const stats = await getPeriodStatistics(property.id);
      const arrivals = await listArrivals(property.id, BUSINESS_DATE);
      const counts = await getStayViewCounts(property.id, BUSINESS_DATE);
      return {
        property,
        occupancyPct: stats?.occupancyPct ?? 0,
        adr: stats?.adr ?? 0,
        revpar: stats?.revpar ?? 0,
        arrivals: arrivals.length,
        dirty: counts.Dirty ?? 0,
      };
    }),
  );
}

const columns: Column<Row>[] = [
  {
    key: "property",
    header: "Property",
    cell: (r) => (
      <Link
        to={`/h/${r.property.id}/stay`}
        className="group inline-flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-orange transition-colors duration-150"
      >
        {r.property.name}
        <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </Link>
    ),
  },
  {
    key: "rooms", header: "Rooms", numeric: true,
    cell: (r) => <span className="tabular">{r.property.rooms}</span>,
  },
  {
    key: "occ", header: "Occupancy", numeric: true,
    cell: (r) => <span className="tabular font-medium">{r.occupancyPct}%</span>,
  },
  {
    key: "adr", header: "ADR", numeric: true,
    cell: (r) => <span className="tabular">{money(r.adr)}</span>,
  },
  {
    key: "revpar", header: "RevPAR", numeric: true,
    cell: (r) => <span className="tabular">{money(r.revpar)}</span>,
  },
  {
    key: "arrivals", header: "Arrivals due", numeric: true,
    cell: (r) => <span className="tabular">{r.arrivals}</span>,
  },
  {
    key: "dirty", header: "Rooms dirty", numeric: true,
    cell: (r) => (
      <span className={cnDirty(r.dirty)}>{r.dirty}</span>
    ),
  },
];

const cnDirty = (n: number) =>
  n > 0 ? "tabular font-medium text-brand-yellow" : "tabular text-grey-400";

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", BUSINESS_DATE],
    queryFn: buildRows,
  });

  const group = data?.reduce(
    (t, r) => ({
      rooms: t.rooms + r.property.rooms,
      arrivals: t.arrivals + r.arrivals,
    }),
    { rooms: 0, arrivals: 0 },
  );

  return (
    <Page>
      <PageHeader
        title="Fidato Hotels"
        description="Period to date, 1–25 August 2026. Figures reconcile to each property's Manager Report."
      />

      {/* The single hero accent on the page */}
      <div className="rounded-md brand-gradient p-5 mb-6 text-white">
        <p className="text-2xs font-semibold uppercase tracking-wide opacity-80">
          Group, period to date
        </p>
        <div className="flex items-baseline gap-6 flex-wrap mt-2">
          <div>
            <p className="text-2xl font-semibold tabular">{group?.rooms ?? "—"}</p>
            <p className="text-xs opacity-80">rooms across {data?.length ?? 0} propert{data?.length === 1 ? "y" : "ies"}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular">{group?.arrivals ?? "—"}</p>
            <p className="text-xs opacity-80">arrivals due today</p>
          </div>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
          </CardBody>
        ) : (
          <DataTable<Row>
            rows={data ?? []}
            columns={columns}
            rowKey={(r) => r.property.id}
          />
        )}
      </Card>

      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        Six of the seven properties are not yet configured — their names and room
        counts are unconfirmed, and inventing them would put wrong numbers in
        front of people. They appear here as they are added.
      </p>
    </Page>
  );
}
