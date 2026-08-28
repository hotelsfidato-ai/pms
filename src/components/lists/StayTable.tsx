import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import {
  DataTable, StatusPill, Input, Drawer, DrawerContent,
  Tabs, TabsList, TabsTrigger, TabsContent, type Column, type Tone,
} from "@/components/ui";
import { CheckInFlow } from "@/components/flows/CheckInFlow";
import { FolioPanel } from "@/components/flows/FolioPanel";
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

const TONE: Record<string, Tone> = {
  "due-in": "info",
  "in-house": "success",
  "due-out": "warning",
  "checked-out": "neutral",
  "no-show": "danger",
  cancelled: "danger",
};

const LABEL: Record<string, string> = {
  "due-in": "Due in",
  "in-house": "In house",
  "due-out": "Due out",
  "checked-out": "Checked out",
  "no-show": "No show",
  cancelled: "Cancelled",
};

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
    cell: (s) => <span className="text-grey-600">{s.source}</span>,
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
        <span className="text-grey-400">—</span>
      ) : (
        <span
          className={cn(
            "font-medium tabular",
            s.balance > 0 ? "text-brand-red"
              : s.balance < 0 ? "text-info"
              : "text-success",
          )}
        >
          {money(Math.abs(s.balance))}
          {s.balance < 0 && (
            <span className="ml-1 text-2xs font-normal text-grey-500">over</span>
          )}
        </span>
      ),
  },
};

export interface StayRow extends Stay {
  /** Present on folio-oriented lists; absent elsewhere. */
  balance?: number;
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
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const selectedId = searchParams.get("res");

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
        <div className="relative flex-1 max-w-xs">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Guest, reference or room…"
            leadingIcon={<Search className="size-4" />}
            aria-label="Filter this list"
          />
        </div>
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-md text-sm text-grey-600 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
        <span className="ml-auto text-sm text-grey-500 tabular">
          {filtered.length} of {(rows ?? []).length}
        </span>
      </div>

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
            <p className="text-base text-grey-500 mt-1.5">{emptyBody}</p>
          </div>
        }
      />

      {/* The same panel the tape chart opens, so nothing is relearned. */}
      <Drawer open={!!selected} onOpenChange={(o) => !o && close()}>
        {selected && (
          <DrawerContent
            title={selected.guest}
            description={`Room ${selected.roomNumber} · ${selected.reference}`}
            width="lg"
          >
            <Tabs defaultValue={defaultTab}>
              <TabsList>
                <TabsTrigger value="stay">Stay</TabsTrigger>
                <TabsTrigger value="folio">Folio</TabsTrigger>
              </TabsList>

              <TabsContent value="stay">
                <div className="space-y-5 pt-1">
                  <StaySummary stay={selected} />
                  {offerCheckIn && selected.status === "due-in" && (
                    <CheckInFlow
                      hotelId={hotelId}
                      stay={selected}
                      businessDate={businessDate}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="folio">
                <div className="pt-1">
                  <FolioPanel
                    hotelId={hotelId}
                    stay={selected}
                    businessDate={businessDate}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </DrawerContent>
        )}
      </Drawer>
    </>
  );
}

function StaySummary({ stay }: { stay: StayRow }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill tone={TONE[stay.status] ?? "neutral"} dot>
          {LABEL[stay.status] ?? stay.status}
        </StatusPill>
        {stay.isComplimentary && <StatusPill tone="accent">Complimentary</StatusPill>}
        {stay.isDayUse && <StatusPill tone="neutral">Day use</StatusPill>}
        {stay.groupId && <StatusPill tone="accent">Group</StatusPill>}
      </div>

      <dl className="divide-y divide-grey-100">
        <Row label="Arrival" value={dateShort(stay.arrival)} tabular />
        <Row label="Departure" value={dateShort(stay.departure)} tabular />
        <Row label="Nights" value={stay.isDayUse ? "Day use" : String(stay.nights)} tabular />
        <Row
          label="Party"
          value={`${stay.adults} adult${stay.adults === 1 ? "" : "s"}${stay.children ? `, ${stay.children} child` : ""}`}
        />
        <Row label="Source" value={stay.source} />
        <Row label="Rate plan" value={stay.ratePlan} />
        <Row label="Rack rate" value={money(stay.rackTariff)} tabular />
        <Row
          label="Offered"
          value={stay.isComplimentary ? "Complimentary" : money(stay.offeredTariff)}
          tabular
        />
      </dl>

      {stay.notes && (
        <div className="rounded-md bg-grey-50 border border-grey-200 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-grey-400 mb-1">
            Note
          </p>
          <p className="text-sm text-grey-700 leading-relaxed">{stay.notes}</p>
        </div>
      )}
    </div>
  );
}

function Row({
  label, value, tabular,
}: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(110px,160px)_1fr] gap-4 py-2.5">
      <dt className="text-sm text-grey-500">{label}</dt>
      <dd className={cn("text-base text-ink-900 min-w-0", tabular && "tabular")}>
        {value}
      </dd>
    </div>
  );
}
