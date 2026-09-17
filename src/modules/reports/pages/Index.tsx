import { useState } from "react";
import { Link } from "react-router";
import {
  Star, Search, ArrowRight, ClipboardList, CalendarDays, ChartColumn,
  ChartNoAxesColumn, Building2, UserX, ReceiptText, Wallet, Landmark,
  FileSpreadsheet, Plane, ScrollText, type LucideIcon,
} from "lucide-react";
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
  /** Its own glyph, so the eye finds the row before it reads it. One
      family, one size — eleven copies of a page icon would say nothing. */
  icon: LucideIcon;
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
        title: "Manager report",
        icon: ClipboardList,
        path: "/reports/manager",
        description: "Today, period to date and year to date in three columns. The one an owner opens first.",
      },
      {
        title: "Night audit report",
        icon: ScrollText,
        path: "/reports/night-audit",
        description: "What happened on one day, to the paisa: rooms charged, who left, every receipt, the restaurant.",
      },
      {
        title: "Monthly occupancy",
        icon: CalendarDays,
        path: "/reports/monthly-occupancy",
        description: "Occupancy for every day of the month, as a chart. Full houses and empty ones both stand out.",
      },
      {
        title: "Monthly statistics",
        icon: ChartColumn,
        path: "/reports/monthly-stats",
        description: "The daily grid - rooms sold, ADR, RevPAR, pax, charges, tax and receipts.",
      },
      {
        title: "Yearly statistics",
        icon: ChartNoAxesColumn,
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
        title: "City ledger",
        icon: Building2,
        path: "/reports/city-ledger",
        description: "What each booking source owes, and what has been received against it.",
      },
      {
        title: "No show",
        icon: UserX,
        path: "/reports/no-show",
        description: "Bookings that never arrived, with the retention charged against each.",
      },
      {
        title: "Guest ledger",
        icon: ReceiptText,
        path: "/reports/guest-ledger",
        description: "Every folio that moved, with its opening and closing balance.",
      },
      {
        title: "Cashier shift",
        icon: Wallet,
        path: "/reports/cashier-shift",
        description: "What each cashier took today, by method. Reversed receipts excluded.",
      },
    ],
  },
  {
    title: "Statutory",
    note: "Filed, not read. These have to reconcile to the rupee.",
    reports: [
      {
        title: "Lodging tax",
        icon: Landmark,
        path: "/reports/lodging-tax",
        description: "CGST and SGST at 2.5% each, split by tax slab, as the return expects it.",
      },
      {
        title: "GST sales register",
        icon: FileSpreadsheet,
        path: "/reports/gst-sales",
        description: "Invoice-level GSTR-1 extract, credit notes as their own rows.",
      },
      {
        title: "Form F / C-Form",
        icon: Plane,
        path: "/reports/c-form",
        description: "Foreign national arrivals, their documents, and what was filed with the FRRO.",
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
        /* The menu entry's words (REP-3). It said "Reports" under a menu
           entry reading "All reports" — the kind of difference that makes
           somebody wonder whether they opened the right screen. */
        title="All reports"
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
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              "grid place-items-center size-8 rounded-md shrink-0",
              report.path ? "bg-grey-100 text-grey-500" : "bg-grey-50 text-grey-300",
            )}
          >
            <report.icon className="size-4" aria-hidden />
          </span>
          <p className={cn("text-base font-semibold", report.path ? "text-ink-900" : "text-grey-500")}>
            {report.title}
          </p>
        </div>
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
        <span className="inline-flex items-center gap-1.5 text-sm text-brand-orange-700 mt-3">
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
