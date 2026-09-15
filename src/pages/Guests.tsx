import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { AlertTriangle, Building2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, CardBody, DataTable, StatusPill, Avatar, EmptyState, type Column, type Tone } from "@/components/ui";
import { listGuests, listCompanies, type GuestRecord, type CompanyRecord } from "@/data/repositories";

/* Split out of Directory.tsx on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Service: guests. Unchanged. */

/* ══════════════════════════════════════════════════════════════════
   GUESTS · COMPANIES · PROPERTIES · NOTIFICATIONS
   ROOM TYPES · RATE PLANS

   All derived. A guest is not a separate record in Stage 1 — it is
   what you get when you group stays by name, and duplicates are shown
   rather than silently merged, because the merge rules are not
   decided and a wrong merge is far harder to undo than a visible one.
   ══════════════════════════════════════════════════════════════════ */

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Guests ──────────────────────────────────────────────────────── */

const GUEST_COLUMNS: Column<GuestRecord>[] = [
  {
    key: "name", header: "Guest",
    cell: (g) => (
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar name={g.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate">{g.name}</p>
          {g.possibleDuplicate && (
            <p className="text-2xs text-brand-yellow flex items-center gap-1 mt-0.5">
              <AlertTriangle className="size-3" />
              overlapping stays
            </p>
          )}
        </div>
      </div>
    ),
  },
  { key: "stays", header: "Stays", numeric: true, cell: (g) => <span className="tabular">{g.stays}</span> },
  { key: "nights", header: "Nights", numeric: true, hideBelow: "sm", cell: (g) => <span className="tabular">{g.nights}</span> },
  {
    key: "last", header: "Last stay", hideBelow: "md",
    cell: (g) => (
      <div>
        <p className="tabular text-grey-600">
          {g.lastStay ? dateShort(g.lastStay) : <span className="text-grey-400">first visit</span>}
        </p>
        {g.nextStay && (
          <p className="text-2xs text-info tabular mt-0.5">back {dateShort(g.nextStay)}</p>
        )}
      </div>
    ),
  },
  {
    key: "sources", header: "Booked via", hideBelow: "lg",
    cell: (g) => <span className="text-grey-600 truncate">{g.sources.join(", ")}</span>,
  },
  { key: "spend", header: "Total spend", numeric: true, cell: (g) => <span className="tabular">{money(g.totalSpend)}</span> },
  {
    key: "balance", header: "Balance", numeric: true,
    cell: (g) => (
      <span className={cn("tabular font-medium", g.openBalance > 0 ? "text-brand-red" : g.openBalance < 0 ? "text-info" : "text-grey-400")}>
        {g.openBalance === 0 ? "—" : money(Math.abs(g.openBalance))}
      </span>
    ),
  },
];

export function GuestsPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["guests", hotelId],
    queryFn: () => listGuests(hotelId),
  });

  const dupes = (data ?? []).filter((g) => g.possibleDuplicate);

  return (
    <Page>
      <PageHeader
        title="Guests"
        description="Grouped by name from every stay. Repeat guests rise to the top."
        badge={data ? <StatusPill tone="neutral">{data.length} guests</StatusPill> : undefined}
      />

      {dupes.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-brand-yellow-100 bg-brand-yellow-50 p-3.5 mb-4">
          <AlertTriangle className="size-4 text-brand-yellow shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900">
              {dupes.length} name{dupes.length === 1 ? " has" : "s have"} stays that overlap
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              One person cannot be in two rooms on the same night, so either these are
              two people sharing a name or something was entered twice. Shown, not
              merged — a wrong merge is far harder to undo than a visible duplicate.
            </p>
          </div>
        </div>
      )}

      <Card>
        <DataTable<GuestRecord>
          rows={data ?? []}
          columns={GUEST_COLUMNS}
          rowKey={(g) => g.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={
            <EmptyState compact icon={<Users />} title="No guests yet"
              description="A guest is added here the first time they are booked." />
          }
        />
      </Card>
    </Page>
  );
}

/* ── Booking sources ─────────────────────────────────────────────
   CALLED "COMPANIES" UNTIL SOMEBODY LOOKED AT IT. In hotel software a
   company is a corporate account — a firm that books rooms for its own
   staff and settles monthly on the city ledger. This screen is not that.
   It is where the business came FROM: Agoda, Expedia, Booking.com,
   go-MMT, the walk-in, the property's own site.

   The data was always right; `kind` has carried OTA / Direct /
   Corporate from the start. The NAME was wrong, and a wrong name on a
   screen is not cosmetic — it is what somebody looking for their OTA
   performance reads and moves past.

   GROUPED BY CHANNEL, because the question this screen exists to
   answer is "which OTA sent what", and that cannot be read off a list
   sorted by revenue with the channels interleaved.
   ──────────────────────────────────────────────────────────────── */

const KIND_TONE: Record<CompanyRecord["kind"], Tone> = {
  OTA: "accent",
  Direct: "info",
  Corporate: "neutral",
};

/* Order matters: OTAs first, because they are the ones with a
   commission against them and the ones somebody is checking. */
const KIND_ORDER: CompanyRecord["kind"][] = ["OTA", "Direct", "Corporate"];

const KIND_COPY: Record<CompanyRecord["kind"], { title: string; blurb: string }> = {
  OTA: {
    title: "Travel agents",
    blurb: "Booked through a channel, and charged a commission for it.",
  },
  Direct: {
    title: "Direct",
    blurb: "Straight to the property. No commission on any of it.",
  },
  Corporate: {
    title: "Corporate accounts",
    blurb: "A firm booking for its own people, settled on the city ledger.",
  },
};

const SOURCE_COLUMNS: Column<CompanyRecord>[] = [
  { key: "name", header: "Source", cell: (c) => <span className="font-medium">{c.name}</span> },
  { key: "bookings", header: "Bookings", numeric: true, cell: (c) => <span className="tabular">{c.bookings}</span> },
  { key: "nights", header: "Room nights", numeric: true, hideBelow: "sm", cell: (c) => <span className="tabular">{c.roomNights}</span> },
  { key: "revenue", header: "Revenue", numeric: true, cell: (c) => <span className="tabular">{money(c.revenue)}</span> },
  {
    key: "commission", header: "Commission", numeric: true, hideBelow: "lg",
    cell: (c) => <span className="text-grey-400">{c.commissionPct === null ? "—" : `${c.commissionPct}%`}</span>,
  },
  {
    key: "balance", header: "Owed", numeric: true,
    cell: (c) => (
      <span className={cn("tabular font-medium", c.openBalance > 0 ? "text-brand-red" : c.openBalance < 0 ? "text-info" : "text-grey-400")}>
        {c.openBalance === 0 ? "—" : money(Math.abs(c.openBalance))}
      </span>
    ),
  },
];

export function CompaniesPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["companies", hotelId],
    queryFn: () => listCompanies(hotelId),
  });

  const rows = data ?? [];
  const groups = KIND_ORDER
    .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  const sum = (rs: CompanyRecord[], f: (r: CompanyRecord) => number) =>
    rs.reduce((n, r) => n + f(r), 0);

  const otaRevenue = sum(rows.filter((r) => r.kind === "OTA"), (r) => r.revenue);
  const directRevenue = sum(rows.filter((r) => r.kind === "Direct"), (r) => r.revenue);
  const total = otaRevenue + directRevenue
    + sum(rows.filter((r) => r.kind === "Corporate"), (r) => r.revenue);

  return (
    <Page>
      <PageHeader
        title="Booking sources"
        description="Where the business came from, and what each channel is worth."
      />

      {/* THE SPLIT, before the detail. "How much of this did we pay
          commission on" is the first question, and reading it off six
          rows of a table is arithmetic somebody should not have to do.
          Percentages are of revenue that HAS a source; nothing is
          invented when the list is empty. */}
      {!isLoading && !error && total > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Through an agent</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(otaRevenue)}
              </p>
              <p className="text-sm text-grey-500 mt-0.5 tabular">
                {Math.round((otaRevenue / total) * 100)}% of the revenue
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Direct</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(directRevenue)}
              </p>
              <p className="text-sm text-grey-500 mt-0.5 tabular">
                {Math.round((directRevenue / total) * 100)}% of the revenue
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Owed to the property</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(sum(rows, (r) => Math.max(r.openBalance, 0)))}
              </p>
              <p className="text-sm text-grey-500 mt-0.5">
                Across every source that owes anything
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {error || isLoading || groups.length === 0 ? (
        <Card>
          <DataTable<CompanyRecord>
            rows={rows}
            columns={SOURCE_COLUMNS}
            rowKey={(c) => c.id}
            loading={isLoading}
            error={error}
            onRetry={() => refetch()}
            empty={
              <EmptyState compact icon={<Building2 />} title="No bookings yet"
                description="Each company, agent and booking site shows here once a booking comes through it." />
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.kind}>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-2.5">
                <h2 className="text-md font-semibold text-ink-900">
                  {KIND_COPY[g.kind].title}
                </h2>
                <StatusPill tone={KIND_TONE[g.kind]}>{g.rows.length}</StatusPill>
                <span className="text-sm text-grey-500">
                  {KIND_COPY[g.kind].blurb}
                </span>
                <span className="ml-auto text-sm text-grey-600 tabular">
                  {money(sum(g.rows, (r) => r.revenue))}
                  {" · "}
                  {sum(g.rows, (r) => r.bookings)} bookings
                </span>
              </div>
              <Card>
                <DataTable<CompanyRecord>
                  rows={g.rows}
                  columns={SOURCE_COLUMNS}
                  rowKey={(c) => c.id}
                />
              </Card>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        Commission is charged outside this system today and prints as a dash rather
        than a zero. It fills when the channel bridge lands at Stage 9.
      </p>
    </Page>
  );
}
