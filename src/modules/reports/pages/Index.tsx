import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Star, Search, ArrowRight, ClipboardList, CalendarDays, ChartColumn,
  ChartNoAxesColumn, Building2, UserX, ReceiptText, Wallet, Landmark,
  FileSpreadsheet, Plane, ScrollText, Boxes, ArrowLeftRight, PackageOpen, Trash2, ClipboardCheck,
  Hourglass, Gauge, Truck, Refrigerator, Wine, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { mayReach } from "@/components/app/navigation";
import { getModules } from "@/data/repositories";
import { Page, PageHeader, Card, CardBody, StatusPill, SearchInput, EmptyState, IconChip } from "@/components/ui";

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
        description: "Bills transferred to a company or booking site, account by account.",
      },
      {
        title: "No show",
        icon: UserX,
        path: "/reports/no-show",
        description: "Bookings that never arrived on a day. It prints even when nobody did.",
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
        description: "CGST and SGST at each slab's rate, as the return expects it.",
      },
      {
        title: "GST sales register",
        icon: FileSpreadsheet,
        path: "/reports/gst-sales",
        description: "Invoice-level GSTR-1 extract, credit notes as their own rows.",
      },
      {
        title: "Form III register",
        icon: Plane,
        path: "/reports/c-form",
        description: "Foreign guests' arrivals and departures in Form III's order, and the FRRO portal's numbers.",
      },
    ],
  },
  /* Phase 3A (D27-238). Their readers are the owner's D27-240: each row is
     offered only to whom its menu entry is (mayReach, below). */
  {
    title: "Store and equipment",
    note: "What the stores hold and use, and where the equipment is. Costs as recorded.",
    reports: [
      { title: "Closing stock", icon: Boxes, path: "/reports/stock-on-hand",
        description: "Each store's stock on a date, at the average cost as recorded." },
      { title: "Stock movement by day", icon: ArrowLeftRight, path: "/reports/stock-movements",
        description: "Received, issued, wasted and counted, one row a day." },
      { title: "Consumption", icon: PackageOpen, path: "/reports/stock-consumption",
        description: "What was issued, per item and per outlet." },
      { title: "Wastage and breakage", icon: Trash2, path: "/reports/stock-wastage",
        description: "Every wastage, and every breakage with who broke it." },
      { title: "Count differences", icon: ClipboardCheck, path: "/reports/stock-count-differences",
        description: "What each count corrected, and why." },
      { title: "Dead stock", icon: Hourglass, path: "/reports/stock-dead",
        description: "Stock that has not gone out for 30, 60 or 90 days." },
      { title: "Days of cover", icon: Gauge, path: "/reports/stock-cover",
        description: "How long each item lasts at the last 7 days' use." },
      { title: "Supplier spend", icon: Truck, path: "/reports/supplier-spend",
        description: "Deliveries per supplier, and each item's first and last price." },
      { title: "Equipment report", icon: Refrigerator, path: "/reports/equipment",
        description: "What is out of the store, under repair, and when warranties and AMCs end." },
      { title: "Bar stock", icon: Wine, path: "/reports/bar-stock",
        description: "The bar's day: each drink's opening, purchases, sales, count and closing." },
      { title: "FLR-1A/2A/3A register", icon: Wine, path: "/reports/flr-daily",
        description: "The daily excise register: each brand's opening, receipts, sales and closing, by bottle size." },
      { title: "FLR-3 register", icon: Wine, path: "/reports/flr-monthly",
        description: "The monthly excise register: received, sold and closing, day by day, by class and size." },
    ],
  },
];

const BUILT = GROUPS.flatMap((g) => g.reports).filter((r) => r.path).length;

/** The hotel's switches, from the sidebar's own cache entry: a report behind one that is
    off (Bar stock, D27-367) is not offered. */
function useModules() {
  const hotelId = useUi((s) => s.hotelId) ?? "";
  return useQuery({ queryKey: ["modules", hotelId], queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId), staleTime: 5 * 60_000 }).data;
}

/** The Store and equipment group alone, at its own address (STOCK_REPORTS_PATH):
    the Store page's "Reports" button lands here, open to D27-240's readers,
    the Inventory Manager included, who cannot open All reports. */
export function StoreReportsPage() {
  const favourites = useUi((s) => s.favouriteReports);
  const toggle = useUi((s) => s.toggleFavouriteReport);
  const role = useRole();
  const modules = useModules();
  const group = GROUPS.find((g) => g.title === "Store and equipment")!;
  const reports = group.reports.filter((r) => r.path && mayReach(role, r.path, modules));
  return (
    <Page>
      <PageHeader title="Store reports" description={group.note} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <ReportCard key={r.title} report={r} starred={favourites.includes(r.path!)}
            onToggle={() => toggle(r.path!)} />
        ))}
      </div>
    </Page>
  );
}
const TOTAL = GROUPS.flatMap((g) => g.reports).length;

export default function ReportsIndexPage() {
  const [search, setSearch] = useState("");
  const favourites = useUi((s) => s.favouriteReports);
  const toggle = useUi((s) => s.toggleFavouriteReport);

  const role = useRole();
  const modules = useModules();
  const q = search.trim().toLowerCase();
  /* A report the menu hides from this role is not offered here either
     (D25-38: the C-Form's passports are the check-in roles' only). */
  const matches = (r: ReportLink) => (!r.path || mayReach(role, r.path, modules)) && (
    !q ||
    r.title.toLowerCase().includes(q) ||
    r.description.toLowerCase().includes(q));

  const groups = GROUPS.map((g) => ({ ...g, reports: g.reports.filter(matches) }))
    .filter((g) => g.reports.length > 0);

  const starred = GROUPS.flatMap((g) => g.reports).filter(
    (r) => r.path && favourites.includes(r.path) && mayReach(role, r.path, modules),
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

      <div className="max-w-sm mb-5">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Find a report"
          aria-label="Find a report"
        />
      </div>

      {starred.length > 0 && !q && (
        <section className="mb-6">
          <h2 className="text-md font-semibold text-ink-900 mb-3">
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
          <EmptyState compact icon={<Search />} title="No report matches that"
            description="Try the name of a column instead — the descriptions carry them." />
        </Card>
      ) : (
        <div className="space-y-6">
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
          <IconChip className={cn(!report.path && "text-grey-400")}>
            <report.icon />
          </IconChip>
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
            className="p-2 -m-2 rounded-full text-grey-400 hover:text-brand-yellow transition-colors duration-150 shrink-0"
          >
            <Star className={cn("size-4", starred && "fill-brand-yellow text-brand-yellow")} />
          </button>
        ) : (
          <StatusPill tone="neutral" dot={false}>{report.stage}</StatusPill>
        )}
      </div>
      <p className="text-sm text-grey-600 mt-1.5 leading-relaxed">{report.description}</p>
      {report.path && (
        <span className="mt-auto pt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange-700">
          Open
          <ArrowRight className="size-3.5" />
        </span>
      )}
    </>
  );

  if (!report.path) {
    return (
      <Card className="border-dashed h-full">
        <CardBody className="flex flex-col h-full">{body}</CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full press-tile transition-colors duration-150 hover:border-grey-300">
      <Link to={report.path} className="block h-full">
        <CardBody className="flex flex-col h-full">{body}</CardBody>
      </Link>
    </Card>
  );
}
