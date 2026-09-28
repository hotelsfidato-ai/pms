import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ClipboardList, LogIn, Users, LogOut, UserX } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, StatusPill, SearchInput, IconChip } from "@/components/ui";
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

/* The chips are the key, in each state's own colour (D27-48): due in
   orange, in house blue; the rest neutral. */
const FILTERS: Array<{
  key: string; label: string; status?: StayStatus[];
  icon: typeof LogIn; chip: "neutral" | "orange" | "blue";
}> = [
  { key: "all", label: "All", icon: ClipboardList, chip: "neutral" },
  { key: "due-in", label: "Due in", status: ["due-in"], icon: LogIn, chip: "orange" },
  { key: "in-house", label: "In house", status: ["in-house", "due-out"], icon: Users, chip: "blue" },
  { key: "checked-out", label: "Checked out", status: ["checked-out"], icon: LogOut, chip: "neutral" },
  /* A voided booking was in All and in no tab (QA BK-10). The API sends
     "void"; StayStatus (the core's types.ts) does not list it yet. */
  { key: "lost", label: "Cancelled, void & no-show", status: ["cancelled", "void" as StayStatus, "no-show"], icon: UserX, chip: "neutral" },
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
  /* A phone is found by its digits, however it was typed (QA BK-10). */
  const digits = q.replace(/\D/g, "");

  /* Filtering happens here rather than in the query so switching a
     tab does not re-fetch, and the counts on every tab stay live. */
  const rows = (data ?? [])
    .filter((s) => !active.status || active.status.includes(s.status))
    .filter(
      (s) =>
        !q ||
        s.guest.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.roomNumber.includes(q) ||
        (digits.length >= 3 && (s.phone ?? "").replace(/\D/g, "").includes(digits)),
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
        /* The search sits in the title row, the filters under it. */
        actions={
          <SearchInput
            className="w-full sm:w-64"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Guest, reference or room"
            aria-label="Search bookings"
          />
        }
      />

      {/* The filters: a row of level count tiles, as on Rooms and the
          Calendar (tapped more than anything else here, so 44px and more
          under a thumb). The chosen one is navy. The label comes first in
          the markup and sits under the count on screen. On a phone the
          row scrolls inside itself, snapping. */}
      <div
        role="group"
        aria-label="Filter bookings"
        className="mb-5 grid sm:grid-cols-5 gap-2
                   max-sm:flex max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-5
                   max-sm:-mx-5 max-sm:px-5 max-sm:py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                   max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]"
      >
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.key)}
              className={cn(
                "press-tile row-span-2 grid grid-rows-subgrid gap-y-1 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset",
                "max-sm:shrink-0 max-sm:min-w-[116px] max-sm:snap-start max-sm:px-3.5 max-sm:py-3",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                on ? "bg-ink-900 ring-ink-900" : "bg-white ring-grey-200 hover:ring-grey-400",
              )}
            >
              <span className={cn(
                "row-start-2 text-sm leading-[18px] max-sm:whitespace-nowrap",
                on ? "text-white/72" : "text-grey-600",
              )}>
                {f.label}
              </span>
              <span className="row-start-1 flex items-center gap-2">
                <IconChip size={24} tone={on ? "glass" : f.chip}><Icon /></IconChip>
                {/* Not read yet is a dash, never a 0. */}
                <b className={cn(
                  "text-xl leading-6 font-semibold tabular tracking-[-0.02em]",
                  on ? "text-white" : data ? "text-ink-900" : "text-grey-500",
                )}>
                  {data ? countFor(f) : "-"}
                </b>
              </span>
            </button>
          );
        })}
      </div>

      <StayTable
        hotelId={hotelId}
        businessDate={BUSINESS_DATE}
        rows={rows as Stay[]}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        columns={COLUMNS}
        offerCheckIn
        /* One search on this screen, the one in the title row (the owner,
           27 September). */
        showFilter={false}
        emptyTitle={q ? "Nothing matches that" : "No bookings in this state"}
        emptyBody={
          q
            ? "Try a shorter search - a surname, or the last few digits of a reference."
            : "Bookings move between these states as the day runs. Nothing here is missing; there is simply nothing in this state."
        }
      />
    </Page>
  );
}
