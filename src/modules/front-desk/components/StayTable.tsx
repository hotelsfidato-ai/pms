import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Search, X, Rows3, LayoutGrid, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import {
  DataTable, StatusPill, Input, type Column, type Tone,
} from "@/components/ui";
import { StayDrawer } from "@/modules/front-desk/flows/StayDrawer";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   STAY TABLE

   One table, configured — not four near-copies. Arrivals, in house,
   due out and upcoming differ only in which stays they are handed and
   which columns earn their place, so they pass those in rather than
   each owning a table of their own.

   Clicking a row opens the same panel the tape chart opens, so a
   clerk moves between the list and the chart without relearning
   anything.
   ══════════════════════════════════════════════════════════════════ */

/* One colour per state, everywhere (the owner, 27 September): in house
   is blue as on Rooms and the Calendar; due in is orange, as Arriving is. */
const TONE: Record<string, Tone> = {
  "due-in": "accent",
  "in-house": "info",
  "due-out": "warning",
  "checked-out": "neutral",
  "no-show": "danger",
  cancelled: "danger",
  void: "neutral",
  /* Phase 1: a booking held for the hotel to confirm (status 'tentative').
     Grey - not firm yet - the owner, 27 September. */
  tentative: "neutral",
};

const LABEL: Record<string, string> = {
  "due-in": "Due in",
  "in-house": "In house",
  "due-out": "Due out",
  "checked-out": "Checked out",
  "no-show": "No show",
  cancelled: "Cancelled",
  /* A voided booking said "void" (QA BK-10). */
  void: "Void",
  tentative: "Waiting for the hotel",
};

/* One key for every list. Somebody who works from cards works from
   cards on the arrivals screen and the in-house screen alike. */
const VIEW_KEY = "fidato-stay-view";

export type StayColumn =
  | "room" | "guest" | "type" | "plan" | "source"
  | "arrival" | "departure" | "nights" | "status" | "rate" | "balance";

const ALL_COLUMNS: Record<StayColumn, Column<StayRow>> = {
  room: {
    key: "room", header: "Room", width: "w-[88px]",
    cell: (s) => <span className="tabular font-medium">{s.roomNumber}</span>,
  },
  guest: {
    key: "guest", header: "Guest",
    cell: (s) => (
      <div className="min-w-0">
        <p className="truncate">{s.guest}</p>
        <p className="text-2xs text-grey-500 tabular">{s.reference}</p>
      </div>
    ),
  },
  type: {
    key: "type", header: "Type", hideBelow: "md",
    cell: (s) => <span className="text-grey-600">{s.roomType}</span>,
  },
  plan: {
    key: "plan", header: "Plan", hideBelow: "lg",
    cell: (s) => <span className="text-grey-600">{s.ratePlan}</span>,
  },
  source: {
    key: "source", header: "Source", hideBelow: "lg",
    /* A dash, never a guess — see defect 219. */
    cell: (s) => <span className="text-grey-600">{s.source ?? "-"}</span>,
  },
  arrival: {
    key: "arrival", header: "Arrival", hideBelow: "sm",
    cell: (s) => <span className="tabular">{dateShort(s.arrival)}</span>,
  },
  departure: {
    key: "departure", header: "Departure", hideBelow: "sm",
    cell: (s) => <span className="tabular">{dateShort(s.departure)}</span>,
  },
  nights: {
    key: "nights", header: "Nights", numeric: true, hideBelow: "md",
    cell: (s) => (
      <span className="tabular">{s.isDayUse ? "Day use" : s.nights}</span>
    ),
  },
  status: {
    key: "status", header: "Status",
    cell: (s) => (
      <StatusPill tone={TONE[s.status] ?? "neutral"} dot>
        {LABEL[s.status] ?? s.status}
      </StatusPill>
    ),
  },
  rate: {
    key: "rate", header: "Rate", numeric: true,
    cell: (s) =>
      s.isComplimentary ? (
        <span className="text-grey-500">Comp</span>
      ) : (
        <span className="font-medium">{money(s.offeredTariff)}</span>
      ),
  },
  balance: {
    key: "balance", header: "Balance", numeric: true,
    cell: (s) =>
      s.balance === undefined ? (
        <span className="text-grey-500">-</span>
      ) : (
        <span
          className={cn(
            "font-medium tabular",
            s.balance > 0 ? "text-brand-red-700"
              : s.balance < 0 ? "text-info"
              : "text-success-600",
          )}
        >
          {money(Math.abs(s.balance))}
          {/* A real space, not only a margin: it read "₹784over" (QA FI-18). */}
          {s.balance < 0 && (
            <span className="text-2xs font-normal text-grey-500">{" "}over</span>
          )}
        </span>
      ),
  },
};

export interface StayRow extends Stay {
  /** Present on folio-oriented lists; absent elsewhere. */
  balance?: number;
}


/* ══════════════════════════════════════════════════════════════════
   THE SAME LIST, AS CARDS

   A table is right at a desk with a wide screen and forty rows. It is
   wrong on a phone, and it is wrong when somebody is comparing four
   bookings rather than scanning forty — which is most of what a
   manager does with these screens.

   THE CARDS RENDER THE COLUMNS THE PAGE ASKED FOR. Not a second
   opinion about what matters: `columns` decides both views, so a page
   that does not show a balance does not grow one here, and adding a
   column to a page adds it to both. Two views that disagree about what
   a page is about are worse than one view.

   The guest and the room lead, because they are what somebody is
   looking for; everything else is a labelled pair underneath.

   ⚠ A PHONE ALWAYS GETS THESE, whatever the toggle says (16 September,
   the owner's decision). The toggle is a choice worth making at a desk,
   where a table of forty rows is genuinely better; below `sm` a table
   is a sideways scroller and there is nothing to choose between. So the
   toggle hides on a phone and these cards render instead. */
function StayCards({ rows, columns, onOpen }: {
  rows: StayRow[];
  columns: StayColumn[];
  onOpen: (id: string) => void;
}) {
  /* Guest and room carry the card's head. The rest become pairs — and
     `status` is pulled out because it is a mark, not a measurement. */
  const rest = columns.filter(
    (c) => c !== "guest" && c !== "room" && c !== "status");
  const showsStatus = columns.includes("status");

  return (
    /* Named for the test: `DataTable` grew a card list of its own on 16
       September, so "a ul inside a div that hides from sm up" no longer
       identifies THESE cards. A guard that cannot tell the two apart
       passes while the thing it guards is gone. */
    <ul data-stay-cards className="grid gap-2 sm:gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s.id)}
            className="press-tile w-full text-left rounded-lg bg-white ring-1 ring-inset ring-grey-200
                       px-3.5 py-3 cursor-pointer hover:ring-grey-400
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            {/* The Rooms tile's lines: the room and its state, then who. */}
            <div className="flex items-center justify-between gap-2">
              {columns.includes("room") ? (
                <span className="text-xl tabular font-semibold tracking-[-0.02em] text-ink-900">
                  {s.roomNumber || <span className="text-grey-500">-</span>}
                </span>
              ) : <span />}
              <span className="flex items-center gap-2">
                {showsStatus && ALL_COLUMNS["status"].cell(s, i)}
                {/* It opens the stay: an arrow says so (the owner, 27 Sep). */}
                <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-ink-900 truncate">{s.guest}</p>
            <p className="text-xs tabular text-grey-500">{s.reference}</p>

            {/* Labelled values as rows, label left and value right (the
                Data Rule): two 160px columns turned "Booking.com" into
                "Booking.c…", and a list that hides what it is showing is
                not a list. */}
            {rest.length > 0 && (
              <dl className="mt-2.5 pt-2 border-t border-grey-100 grid gap-y-1">
                {rest.map((c) => (
                  <div key={c} className="flex items-baseline justify-between gap-3 min-w-0 text-sm">
                    <dt className="text-grey-500 shrink-0">
                      {ALL_COLUMNS[c].header}
                    </dt>
                    <dd className="text-ink-900 min-w-0 text-right break-words">
                      {ALL_COLUMNS[c].cell(s, i)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StayTable({
  hotelId,
  businessDate,
  rows,
  isLoading,
  error,
  columns,
  emptyTitle,
  emptyBody,
  /** Shown as the panel's action when the row can be checked in. */
  offerCheckIn,
  /** Opens the panel on the folio tab rather than the stay tab. */
  defaultTab = "stay",
  onRetry,
  /** False where the page has its own search over the same rows (All
      bookings: the owner, 27 September, one search box, not two). */
  showFilter = true,
}: {
  hotelId: string;
  businessDate: string;
  rows: StayRow[] | undefined;
  isLoading: boolean;
  error?: unknown;
  columns: StayColumn[];
  emptyTitle: string;
  emptyBody: string;
  offerCheckIn?: boolean;
  defaultTab?: "stay" | "folio";
  onRetry?: () => void;
  showFilter?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const selectedId = searchParams.get("res");

  /* REMEMBERED, per viewer, per device. Somebody who works from cards
     works from cards on every one of these screens, and re-choosing on
     each is the kind of small friction that makes a feature go unused.

     localStorage and not the server: this is a preference about a
     screen, not a fact about the hotel, and it is allowed to differ
     between the desk terminal and the manager's phone — which is the
     whole reason the two views exist.

     Wrapped, because a private window and a browser set to block site
     data both throw here, and a list that will not render because it
     could not remember a layout is a poor trade. */
  const [view, setView] = useState<"table" | "cards">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });

  const chooseView = (next: "table" | "cards") => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* not fatal */ }
  };

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.guest.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.roomNumber.includes(q),
    );
  }, [rows, query]);

  /* Cards — either kind — only once there is something to show. */
  const hasRows = !isLoading && !error && filtered.length > 0;

  const selected = (rows ?? []).find((s) => s.id === selectedId) ?? null;

  const open = (id: string) => {
    searchParams.set("res", id);
    setSearchParams(searchParams);
  };
  const close = () => {
    searchParams.delete("res");
    setSearchParams(searchParams);
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        {showFilter && <div className="relative flex-1 max-w-xs">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Guest, reference or room…"
            leadingIcon={<Search className="size-4" />}
            aria-label="Filter this list"
          />
        </div>}
        {showFilter && query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-sm text-grey-600 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150 pointer-coarse:min-h-11"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
        <span className="ml-auto text-sm text-grey-500 tabular">
          {filtered.length} of {(rows ?? []).length}
        </span>

        {/* A table is right at a desk with forty rows. Cards are right
            on a phone, and right when somebody is comparing four
            bookings rather than scanning forty.

            HIDDEN ON A PHONE, because there the answer is not in doubt:
            the cards render below `sm` whichever way this is set. */}
        <div className="hidden sm:flex items-center gap-0.5 p-[3px] rounded-md bg-grey-100">
          <button
            type="button"
            onClick={() => chooseView("table")}
            aria-pressed={view === "table"}
            aria-label="Show as a table"
            className={cn(
              "size-[30px] grid place-items-center rounded-[7px] cursor-pointer press-tile",
              view === "table"
                ? "bg-white text-ink-900 shadow-[0_1px_2px_rgb(3_23_40/0.08)]"
                : "text-grey-600 hover:text-ink-900",
            )}
          >
            <Rows3 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => chooseView("cards")}
            aria-pressed={view === "cards"}
            aria-label="Show as cards"
            className={cn(
              "size-[30px] grid place-items-center rounded-[7px] cursor-pointer press-tile",
              view === "cards"
                ? "bg-white text-ink-900 shadow-[0_1px_2px_rgb(3_23_40/0.08)]"
                : "text-grey-600 hover:text-ink-900",
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </div>

      {/* Cards only once there is something to show. Loading, an error
          and an empty list are all states DataTable already renders
          properly, and a second set of them would be a second set to
          get wrong. */}
      {view === "cards" && hasRows ? (
        <StayCards rows={filtered} columns={columns} onOpen={open} />
      ) : (
      <>
      {/* The same cards on a phone, whatever the toggle remembers. Both
          branches render when there are rows; the breakpoint decides
          which one anybody sees, so nothing is shown twice. Loading, an
          error and an empty list are not here at all — DataTable draws
          those at every width. */}
      {hasRows && (
        <div className="sm:hidden">
          <StayCards rows={filtered} columns={columns} onOpen={open} />
        </div>
      )}
      <div className={hasRows ? "hidden sm:block" : undefined}>
      <DataTable<StayRow>
        rows={filtered}
        columns={columns.map((c) => ALL_COLUMNS[c])}
        rowKey={(s) => s.id}
        loading={isLoading}
        error={error}
        onRetry={onRetry}
        onRowClick={(s) => open(s.id)}
        hasFilters={query.length > 0}
        onClearFilters={() => setQuery("")}
        empty={
          <div className="text-center">
            <p className="text-md font-semibold text-ink-900">{emptyTitle}</p>
            <p className="text-sm text-grey-500 mt-1.5">{emptyBody}</p>
          </div>
        }
      />
      </div>
      </>
      )}

      {/* THE panel the tape chart opens — one component, not a copy of
          it. This file said "the same panel" for months while drawing a
          second one with fewer rows. */}
      <StayDrawer
        hotelId={hotelId}
        stay={selected}
        businessDate={businessDate}
        status={selected
          ? { tone: TONE[selected.status] ?? "neutral", label: LABEL[selected.status] ?? selected.status }
          : null}
        onClose={close}
        defaultTab={defaultTab}
        offerCheckIn={offerCheckIn ?? false}
      />
    </>
  );
}

/* The status words, for the other lists of stays (Find a screen, D27-239). */
export { LABEL as STAY_LABEL };
