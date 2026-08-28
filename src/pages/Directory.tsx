import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { AlertTriangle, ArrowRight, Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, relative } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill, Skeleton,
  Avatar, ErrorState, type Column, type Tone,
} from "@/components/ui";
import {
  listGuests, listCompanies, listProperties, notificationsRepo,
  listRoomTypes, listRatePlans,
  type GuestRecord, type CompanyRecord, type RoomTypeRecord, type RatePlanRecord,
} from "@/data/repositories";

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
        />
      </Card>
    </Page>
  );
}

/* ── Companies ───────────────────────────────────────────────────── */

const KIND_TONE: Record<CompanyRecord["kind"], Tone> = {
  OTA: "accent",
  Direct: "info",
  Corporate: "neutral",
};

const COMPANY_COLUMNS: Column<CompanyRecord>[] = [
  { key: "name", header: "Account", cell: (c) => <span className="font-medium">{c.name}</span> },
  { key: "kind", header: "Kind", cell: (c) => <StatusPill tone={KIND_TONE[c.kind]}>{c.kind}</StatusPill> },
  { key: "bookings", header: "Bookings", numeric: true, cell: (c) => <span className="tabular">{c.bookings}</span> },
  { key: "nights", header: "Room nights", numeric: true, hideBelow: "sm", cell: (c) => <span className="tabular">{c.roomNights}</span> },
  { key: "revenue", header: "Revenue", numeric: true, cell: (c) => <span className="tabular">{money(c.revenue)}</span> },
  {
    key: "commission", header: "Commission", numeric: true, hideBelow: "lg",
    cell: (c) => <span className="text-grey-400">{c.commissionPct === null ? "—" : `${c.commissionPct}%`}</span>,
  },
  {
    key: "balance", header: "Balance", numeric: true,
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

  return (
    <Page>
      <PageHeader
        title="Companies"
        description="Every booking source that carries an account, with what it has brought in."
      />
      <Card>
        <DataTable<CompanyRecord>
          rows={data ?? []}
          columns={COMPANY_COLUMNS}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        Commission is charged outside this system today and prints as a dash rather
        than a zero. It fills when the channel bridge lands at Stage 9.
      </p>
    </Page>
  );
}

/* ── Properties ──────────────────────────────────────────────────── */

export function PropertiesPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["properties"], queryFn: listProperties });

  return (
    <Page>
      <PageHeader
        title="Properties"
        description="Seven owned. One configured — the rest arrive as their details are confirmed."
      />
      {error ? (
        <Card>
          <ErrorState
            title="The property list did not load"
            description="Nothing was changed. Try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((p) => (
            <Card key={p.id}>
              <CardBody>
                <p className="text-md font-semibold text-ink-900">{p.name}</p>
                <p className="text-sm text-grey-500 mt-1">{p.address}</p>
                <dl className="mt-3 space-y-1">
                  <Line label="Rooms" value={String(p.rooms)} />
                  <Line label="Types" value={p.roomTypes.join(" · ")} />
                  <Line label="Check in / out" value={`${p.checkInTime} / ${p.checkOutTime}`} />
                  <Line label="Tax" value={`CGST ${p.tax.cgst}% + SGST ${p.tax.sgst}%`} />
                </dl>
                <Link
                  to={`/h/${p.id}/stay`}
                  className="inline-flex items-center gap-1.5 text-sm text-brand-orange hover:underline mt-3.5"
                >
                  Open stay view
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardBody>
            </Card>
          ))}

          {/* Six unnamed, deliberately. */}
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={`pending-${i}`} className="border-dashed">
              <CardBody>
                <p className="text-md font-semibold text-grey-400">
                  Property {i + 2}
                </p>
                <p className="text-sm text-grey-500 mt-1">Awaiting confirmation</p>
                <p className="text-xs text-grey-400 mt-3 leading-relaxed">
                  Name and room count unconfirmed. A placeholder that reads as real
                  would put a wrong number in front of someone.
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ── Notifications ───────────────────────────────────────────────── */

const NOTE_TONE: Record<string, Tone> = {
  approval: "warning",
  reservation: "info",
  payment: "danger",
  automation: "accent",
  customer: "info",
  system: "neutral",
};

export function NotificationsPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", hotelId],
    queryFn: () => notificationsRepo.list(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Derived, never stored — so nothing here can go stale while the thing it describes changes."
        badge={data ? <StatusPill tone={data.length ? "warning" : "success"}>{data.length}</StatusPill> : undefined}
      />
      {error ? (
        <Card>
          <ErrorState
            title="Could not work out what needs attention"
            description="These are derived from the day's stays and postings. Nothing is lost — try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data ?? []).length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10">
              <Bell className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">Nothing needs attention</p>
              <p className="text-base text-grey-500 mt-1.5">
                No arrivals outstanding, no balances carrying into departure, no refunds due.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {(data ?? []).map((n) => (
            <Card key={n.id}>
              <CardBody className="flex items-start gap-3">
                <StatusPill tone={NOTE_TONE[n.category] ?? "neutral"} dot>
                  {n.category}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-ink-900">{n.title}</p>
                  <p className="text-sm text-grey-600 mt-0.5">{n.body}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xs text-grey-400 tabular">{relative(n.at)}</p>
                  {n.link && (
                    <Link to={n.link} className="text-sm text-brand-orange hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-grey-500">{label}</span>
      <span className="text-ink-900 tabular text-right min-w-0 truncate">{value}</span>
    </div>
  );
}
