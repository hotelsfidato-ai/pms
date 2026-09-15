import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, StatusPill, SearchInput } from "@/components/ui";
import { StayTable, type StayColumn } from "@/modules/front-desk";
import { listStays } from "@/modules/front-desk";
import { queryKeys, BUSINESS_DATE, type Stay, type StayStatus } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   RESERVATIONS — the whole book

   Arrivals, In house and Folios each answer one question about today.
   This answers the other one: where is a particular booking, whatever
   state it is in. So it filters rather than scopes, and cancelled and
   no-show stays are included — they are exactly what someone comes
   here looking for.
   ══════════════════════════════════════════════════════════════════ */

const COLUMNS: StayColumn[] = [
  "room", "guest", "type", "plan", "source",
  "arrival", "departure", "nights", "status", "rate",
];

const FILTERS: Array<{ key: string; label: string; status?: StayStatus[] }> = [
  { key: "all", label: "All" },
  { key: "due-in", label: "Due in", status: ["due-in"] },
  { key: "in-house", label: "In house", status: ["in-house", "due-out"] },
  { key: "checked-out", label: "Checked out", status: ["checked-out"] },
  { key: "lost", label: "Cancelled & no-show", status: ["cancelled", "no-show"] },
];

export default function ReservationsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.stays(hotelId, "book"),
    queryFn: () => listStays(hotelId),
  });

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;
  const q = search.trim().toLowerCase();

  /* Filtering happens here rather than in the query so switching a
     tab does not re-fetch, and the counts on every tab stay live. */
  const rows = (data ?? [])
    .filter((s) => !active.status || active.status.includes(s.status))
    .filter(
      (s) =>
        !q ||
        s.guest.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.roomNumber.includes(q),
    )
    .sort((a, b) => b.arrival.localeCompare(a.arrival));

  const countFor = (f: (typeof FILTERS)[number]) =>
    (data ?? []).filter((s) => !f.status || f.status.includes(s.status)).length;

  return (
    <Page>
      <PageHeader
        title="All bookings"
        description={`Every booking on the file, in any state. Business date ${dateLong(BUSINESS_DATE)}.`}
        badge={data ? <StatusPill tone="neutral">{data.length} on file</StatusPill> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-base font-medium",
              /* These are how the screen is filtered, tapped more than
                 anything else on it, and 35px under a thumb. */
              "pointer-coarse:min-h-11",
              "border transition-colors duration-150",
              filter === f.key
                ? "bg-ink-900 border-ink-900 text-white"
                : "bg-white border-grey-200 text-grey-600 hover:text-ink-900 hover:border-grey-300",
            )}
          >
            {f.label}
            <span
              className={cn(
                "tabular text-2xs",
                filter === f.key ? "text-white/60" : "text-grey-400",
              )}
            >
              {countFor(f)}
            </span>
          </button>
        ))}
        <div className="ms-auto w-full sm:w-64">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Guest, reference or room"
            aria-label="Search bookings"
          />
        </div>
      </div>

      <Card className="p-4">
        <StayTable
          hotelId={hotelId}
          businessDate={BUSINESS_DATE}
          rows={rows as Stay[]}
          isLoading={isLoading}
          error={error}
          onRetry={() => refetch()}
          columns={COLUMNS}
          offerCheckIn
          emptyTitle={q ? "Nothing matches that" : "No bookings in this state"}
          emptyBody={
            q
              ? "Try a shorter search — a surname, or the last few digits of a reference."
              : "Bookings move between these states as the day runs. Nothing here is missing; there is simply nothing in this state."
          }
        />
      </Card>
    </Page>
  );
}
