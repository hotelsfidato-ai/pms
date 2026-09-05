import { useQuery } from "@tanstack/react-query";
import { dateShort } from "@/lib/format";
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
  /** Null when the statistics did not come back. Not zero — a property
      whose figures failed to load is not one that sold nothing. */
  occupancyPct: number | null;
  adr: number | null;
  revpar: number | null;
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
      /* NULL WHEN THE FIGURES DID NOT COME BACK, not zero. A property
         whose statistics failed to load is not one that sold nothing —
         and 0% occupancy beside ₹0 ADR on a group dashboard is the
         shape of a real bad night, so nobody looks twice at it.

         `dirty` is different: the count genuinely IS zero when no room
         is dirty, and a dash there would read as "we do not know". */
      return {
        property,
        occupancyPct: stats?.occupancyPct ?? null,
        adr: stats?.adr ?? null,
        revpar: stats?.revpar ?? null,
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
    cell: (r) => (
      <span className="tabular font-medium">
        {r.occupancyPct === null
          ? <span className="text-grey-300">—</span>
          : `${r.occupancyPct}%`}
      </span>
    ),
  },
  {
    key: "adr", header: "ADR", numeric: true,
    cell: (r) => (
      <span className="tabular">
        {r.adr === null ? <span className="text-grey-300">—</span> : money(r.adr)}
      </span>
    ),
  },
  {
    key: "revpar", header: "RevPAR", numeric: true,
    cell: (r) => (
      <span className="tabular">
        {r.revpar === null
          ? <span className="text-grey-300">—</span> : money(r.revpar)}
      </span>
    ),
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

/** The first of the month the business date falls in — the same window
    the Manager Report's period-to-date uses, so the caption and the
    figures under it cannot disagree. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

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
        /* DERIVED, because this was the string "1–25 August 2026" —
           typed once and then wrong on every day that was not the 25th
           of August. The screen an owner opens first was captioning
           today's figures with last month's dates, and the API had the
           right window all along: monthStart(businessDate) to the
           business date.

           A date on a screen is a number like any other. This file's
           own rule is that a number is derived or it is a dash. */
        description={
          `Period to date, ${dateShort(monthStart(BUSINESS_DATE))} to `
          + `${dateShort(BUSINESS_DATE)}. Figures reconcile to each `
          + "property's Manager Report."
        }
      />

      {/* The single hero accent on the page */}
      <div className="rounded-md brand-gradient p-5 mb-6 text-white">
        <p className="text-2xs font-semibold uppercase tracking-wide opacity-80">
          Group, period to date
        </p>
        <div className="flex items-baseline gap-6 flex-wrap mt-2">
          <div>
            <p className="text-2xl font-semibold tabular">{group?.rooms ?? "—"}</p>
            <p className="text-xs opacity-80">
              {/* A dash while it loads. "rooms across 0 properties" is a
                  sentence about a group that does not exist. */}
              {data === undefined
                ? "across the group"
                : `rooms across ${data.length} propert${data.length === 1 ? "y" : "ies"}`}
            </p>
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
