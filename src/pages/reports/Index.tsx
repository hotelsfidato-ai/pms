import { useState } from "react";
import { Link } from "react-router";
import { Star, Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, CardBody, StatusPill, SearchInput } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   REPORTS INDEX

   Eight reports were taken from real exports out of the live system.
   They are grouped the way a manager thinks about them — the day, the
   money, the statutory filing — rather than alphabetically, because
   nobody has ever looked for "Monthly Occupancy" under M.

   Reports that do not exist yet are listed and marked, not hidden. A
   manager who cannot find Guest Ledger needs to know it is coming,
   not to wonder whether they are looking in the wrong place.
   ══════════════════════════════════════════════════════════════════ */

interface ReportLink {
  title: string;
  path?: string;
  description: string;
  /** Where it will land, when it is not built. */
  stage?: string;
}

interface Group {
  title: string;
  note: string;
  reports: ReportLink[];
}

const GROUPS: Group[] = [
  {
    title: "The day",
    note: "What happened, and what is about to.",
    reports: [
      {
        title: "Manager Report",
        path: "/reports/manager",
        description: "Today, period to date and year to date in three columns. The one an owner opens first.",
      },
      {
        title: "Monthly Occupancy",
        path: "/reports/monthly-occupancy",
        description: "Occupancy for every day of the month, as a chart. Full houses and empty ones both stand out.",
      },
      {
        title: "Monthly Statistics",
        path: "/reports/monthly-stats",
        description: "The daily grid — rooms sold, ADR, RevPAR, pax, charges, tax and receipts.",
      },
      {
        title: "Yearly Statistics",
        path: "/reports/yearly-stats",
        description: "The same columns at month grain, with a grand total that recomputes rates rather than averaging averages.",
      },
    ],
  },
  {
    title: "Money owed",
    note: "Balances that have left the building without being settled.",
    reports: [
      {
        title: "City Ledger",
        path: "/reports/city-ledger",
        description: "What each booking source owes, and what has been received against it.",
      },
      {
        title: "No Show",
        path: "/reports/no-show",
        description: "Bookings that never arrived, with the retention charged against each.",
      },
      {
        title: "Guest Ledger",
        description: "In-house balances by folio. Today this lives on the Folios screen instead.",
        stage: "Stage 8",
      },
      {
        title: "Cashier Shift",
        description: "Receipts by cashier and shift. Waiting on real user accounts.",
        stage: "Stage 4",
      },
    ],
  },
  {
    title: "Statutory",
    note: "Filed, not read. These have to reconcile to the rupee.",
    reports: [
      {
        title: "Lodging Tax",
        path: "/reports/lodging-tax",
        description: "CGST and SGST at 2.5% each, split by tax slab, as the return expects it.",
      },
      {
        title: "GST Sales Register",
        description: "Invoice-level GSTR-1 extract. Needs the invoice series to be live first.",
        stage: "Stage 8",
      },
      {
        title: "Form F / C-Form",
        description: "Foreign national arrivals for police reporting. Needs passport capture at check-in.",
        stage: "Stage 10",
      },
    ],
  },
];

const BUILT = GROUPS.flatMap((g) => g.reports).filter((r) => r.path).length;
const TOTAL = GROUPS.flatMap((g) => g.reports).length;

export default function ReportsIndexPage() {
  const [search, setSearch] = useState("");
  const favourites = useUi((s) => s.favouriteReports);
  const toggle = useUi((s) => s.toggleFavouriteReport);

  const q = search.trim().toLowerCase();
  const matches = (r: ReportLink) =>
    !q ||
    r.title.toLowerCase().includes(q) ||
    r.description.toLowerCase().includes(q);

  const groups = GROUPS.map((g) => ({ ...g, reports: g.reports.filter(matches) }))
    .filter((g) => g.reports.length > 0);

  const starred = GROUPS.flatMap((g) => g.reports).filter(
    (r) => r.path && favourites.includes(r.path),
  );

  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Taken from real exports out of the live system, so the columns and the totals match what is being read today."
        badge={<StatusPill tone="neutral">{BUILT} of {TOTAL} built</StatusPill>}
      />

      <div className="max-w-sm mb-6">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Find a report"
          aria-label="Find a report"
        />
      </div>

      {starred.length > 0 && !q && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-grey-500 uppercase tracking-wide mb-3">
            Starred
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {starred.map((r) => (
              <ReportCard
                key={r.path}
                report={r}
                starred
                onToggle={() => toggle(r.path!)}
              />
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10">
              <Search className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">No report matches that</p>
              <p className="text-base text-grey-500 mt-1.5">
                Try the name of a column instead — the descriptions carry them.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="text-md font-semibold text-ink-900">{g.title}</h2>
              <p className="text-sm text-grey-500 mt-0.5 mb-3">{g.note}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.reports.map((r) => (
                  <ReportCard
                    key={r.title}
                    report={r}
                    starred={!!r.path && favourites.includes(r.path)}
                    onToggle={r.path ? () => toggle(r.path!) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function ReportCard({
  report, starred, onToggle,
}: {
  report: ReportLink;
  starred: boolean;
  onToggle?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-base font-semibold", report.path ? "text-ink-900" : "text-grey-500")}>
          {report.title}
        </p>
        {report.path ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onToggle?.();
            }}
            aria-label={starred ? `Unstar ${report.title}` : `Star ${report.title}`}
            aria-pressed={starred}
            className="p-1 -m-1 rounded text-grey-300 hover:text-brand-yellow transition-colors duration-150 shrink-0"
          >
            <Star className={cn("size-4", starred && "fill-brand-yellow text-brand-yellow")} />
          </button>
        ) : (
          <StatusPill tone="neutral" dot={false}>{report.stage}</StatusPill>
        )}
      </div>
      <p className="text-sm text-grey-600 mt-1.5 leading-relaxed">{report.description}</p>
      {report.path && (
        <span className="inline-flex items-center gap-1.5 text-sm text-brand-orange mt-3">
          Open
          <ArrowRight className="size-3.5" />
        </span>
      )}
    </>
  );

  if (!report.path) {
    return (
      <Card className="border-dashed">
        <CardBody>{body}</CardBody>
      </Card>
    );
  }

  return (
    <Card className="transition-colors duration-150 hover:border-grey-300">
      <Link to={report.path} className="block">
        <CardBody>{body}</CardBody>
      </Link>
    </Card>
  );
}
