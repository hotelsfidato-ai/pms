import { type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { SkeletonTable, NoResultsState, ErrorState, EmptyState } from "./States";

/* ══════════════════════════════════════════════════════════════════
   DATA TABLE
   Dense, quiet, zebra-free. Numeric columns get tabular figures and
   right alignment so the eye can scan a column of money.

   ⚠ ON A PHONE IT IS NOT A TABLE. Measured at 375px on 16 September:
   six screens a receptionist lives in — Arrivals, In house, Walk-ins,
   All bookings, Guests, Folios — put a table wider than the screen
   inside a sideways scroller, so reading one guest's row meant swiping
   right and losing the name off the left edge. Below `sm` each row is
   a CARD instead: the first column is its heading and every other
   column is a labelled line under it.

   NOTHING IS DROPPED. `hideBelow` exists because a narrow screen has
   no room for a tenth column — a card has room, so a column hidden on
   a small screen is still shown in the card, with its header as the
   label. `DataTable.test.tsx` fails if a column goes missing.
   ══════════════════════════════════════════════════════════════════ */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => ReactNode;
  /** Money, counts, dates — right-aligned with tabular figures. */
  numeric?: boolean;
  sortable?: boolean;
  /** Tailwind width utility, e.g. "w-[140px]". */
  width?: string;
  /** Hidden below this breakpoint to keep tablet views readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const HIDE_BELOW: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  /** Shown when the dataset itself is empty. */
  empty?: ReactNode;
  /** Shown when filters exclude everything. */
  onClearFilters?: () => void;
  hasFilters?: boolean;
  className?: string;
  /** Sticky header — on by default for long lists. */
  stickyHeader?: boolean;
}

export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRetry, onRowClick,
  sortBy, sortDir, onSort, empty, onClearFilters, hasFilters,
  className, stickyHeader = true,
}: DataTableProps<T>) {
  if (error) {
    return (
      <div className={cn("bg-white border border-grey-200 rounded-md", className)}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("bg-white border border-grey-200 rounded-md overflow-hidden", className)}>
        <SkeletonTable columns={columns.length} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={cn("bg-white border border-grey-200 rounded-md", className)}>
        {hasFilters ? (
          <NoResultsState onClear={onClearFilters} />
        ) : (
          empty ?? <EmptyState compact title="Nothing here yet" />
        )}
      </div>
    );
  }

  const sortable = columns.filter((c) => c.sortable);

  return (
    <div
      className={cn(
        "bg-white border border-grey-200 rounded-md overflow-hidden",
        className,
      )}
    >
      {/* ── a phone: one card per row ───────────────────────────────
          The header row goes with the table, so sorting needs its own
          control here or it would be lost on the screens that have it. */}
      <div className="sm:hidden">
        {sortable.length > 0 && onSort && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-grey-100 bg-grey-50">
            <label className="text-2xs uppercase tracking-wide text-grey-500" htmlFor="dt-sort">
              Sort by
            </label>
            <select
              id="dt-sort"
              value={sortBy ?? ""}
              onChange={(e) => onSort(e.target.value)}
              className={cn(
                "min-h-11 flex-1 rounded-md border border-grey-200 bg-white px-2",
                "text-base text-ink-900 cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-brand-orange",
              )}
            >
              {sortable.map((col) => (
                <option key={col.key} value={col.key}>
                  {typeof col.header === "string" ? col.header : col.key}
                </option>
              ))}
            </select>
            {sortBy && (
              <button
                type="button"
                onClick={() => onSort(sortBy)}
                aria-label={sortDir === "asc" ? "Sort highest first" : "Sort lowest first"}
                className={cn(
                  "flex items-center justify-center size-11 rounded-md",
                  "border border-grey-200 bg-white text-grey-600",
                )}
              >
                {sortDir === "asc" ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            )}
          </div>
        )}

        <ul>
          {rows.map((row, index) => {
            const [first, ...rest] = columns;
            const body = (
              <>
                {first && (
                  /* A DIV, not a <p>. A first column is whatever the screen
                     put there — Guests renders an avatar beside the name, in
                     its own <div>, and a <div> inside a <p> is invalid HTML
                     that React reports as a nesting error at runtime. Found
                     in the browser console on /guests the same day. */
                  <div data-card-heading className="text-base font-medium text-ink-900">
                    {first.cell(row, index)}
                  </div>
                )}
                <dl className="mt-1.5 grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1">
                  {rest.map((col) => (
                    <div key={col.key} className="contents">
                      <dt className="text-2xs uppercase tracking-wide text-grey-500 pt-0.5">
                        {col.header}
                      </dt>
                      <dd
                        data-numeric={col.numeric || undefined}
                        /* min-w-0 AND overflow-hidden: a cell whose own
                           renderer wraps the text in a flex row (the guest
                           list's "Agoda, Booking.com, …") otherwise pushes
                           past the card's edge, truncate or not. */
                        className={cn(
                          "text-base text-ink-900 min-w-0 overflow-hidden",
                          /* A cell written for a table truncates on one line.
                             A card has vertical room, so let it wrap instead:
                             a guest's source list read "Agoda, Booking.c…"
                             clipped at the card's edge, without even an
                             ellipsis — truncate does not clip an inline box. */
                          "[&_.truncate]:whitespace-normal [&_.truncate]:overflow-visible",
                          col.numeric && "tabular",
                        )}
                      >
                        {col.cell(row, index)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            );
            return (
              <li key={rowKey(row)} className="border-b border-grey-100 last:border-b-0">
                {onRowClick ? (
                  <button
                    type="button"
                    onClick={() => onRowClick(row)}
                    className={cn(
                      "w-full text-left px-4 py-3 min-h-11",
                      "hover:bg-grey-50 focus:bg-grey-50 outline-none",
                      "focus-visible:ring-2 focus-visible:ring-brand-orange rounded-sm",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── a desk: the table, as it was ─────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto scrollbar-quiet">
        <table className="w-full border-collapse text-base">
          <thead
            className={cn(
              "bg-grey-50 border-b border-grey-200",
              stickyHeader && "sticky top-0 z-10",
            )}
          >
            <tr>
              {columns.map((col) => {
                const isSorted = sortBy === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    data-numeric={col.numeric || undefined}
                    className={cn(
                      "text-2xs font-semibold uppercase tracking-wide text-grey-500",
                      "px-4 h-10 whitespace-nowrap",
                      col.numeric ? "text-right" : "text-left",
                      col.width,
                      col.hideBelow && HIDE_BELOW[col.hideBelow],
                      col.className,
                    )}
                  >
                    {col.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.key)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-ink-900 transition-colors duration-150",
                          col.numeric && "flex-row-reverse",
                          isSorted && "text-ink-900",
                        )}
                      >
                        {col.header}
                        {isSorted ? (
                          sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(row);
                      }
                    : undefined
                }
                className={cn(
                  "border-b border-grey-100 last:border-b-0",
                  "transition-colors duration-150",
                  onRowClick && "cursor-pointer hover:bg-grey-50 focus:bg-grey-50 outline-none",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-numeric={col.numeric || undefined}
                    className={cn(
                      "px-4 py-3 align-middle text-ink-900",
                      col.numeric && "text-right tabular",
                      col.hideBelow && HIDE_BELOW[col.hideBelow],
                      col.className,
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Pagination ────────────────────────────────────────────────── */

export function Pagination({
  page, pageSize, total, onPageChange, className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Windowed page numbers: 1 … 4 5 [6] 7 8 … 20
  const window: (number | "gap")[] = [];
  const push = (n: number | "gap") => window.push(n);
  const near = (n: number) => Math.abs(n - page) <= 1;

  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || near(n)) {
      push(n);
    } else if (window[window.length - 1] !== "gap") {
      push("gap");
    }
  }

  return (
    <div className={cn("flex items-center justify-between gap-4 flex-wrap", className)}>
      <p className="text-sm text-grey-500 tabular">
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of{" "}
        {total.toLocaleString("en-IN")}
      </p>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <PageButton disabled={page === 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </PageButton>

        {window.map((entry, i) =>
          entry === "gap" ? (
            <span key={`gap-${i}`} className="px-1.5 text-grey-500 text-sm">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? "page" : undefined}
              className={cn(
                "min-w-8 h-8 px-2 rounded-sm text-sm tabular transition-colors duration-150",
                entry === page
                  ? "bg-ink-900 text-white font-medium"
                  : "text-grey-600 hover:bg-grey-100 hover:text-ink-900",
              )}
            >
              {entry}
            </button>
          ),
        )}

        <PageButton disabled={page === pages} onClick={() => onPageChange(page + 1)}>
          Next
        </PageButton>
      </nav>
    </div>
  );
}

function PageButton({
  children, disabled, onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 px-2.5 rounded-sm text-sm transition-colors duration-150",
        "text-grey-600 hover:bg-grey-100 hover:text-ink-900",
        "disabled:text-grey-300 disabled:hover:bg-transparent disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
