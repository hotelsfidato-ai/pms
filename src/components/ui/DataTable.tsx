import { type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { SkeletonTable, NoResultsState, ErrorState, EmptyState } from "./States";

/* ══════════════════════════════════════════════════════════════════
   DATA TABLE
   Dense, quiet, zebra-free. Numeric columns get tabular figures and
   right alignment so the eye can scan a column of money.
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

  return (
    <div
      className={cn(
        "bg-white border border-grey-200 rounded-md overflow-hidden",
        className,
      )}
    >
      <div className="overflow-x-auto scrollbar-quiet">
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
            <span key={`gap-${i}`} className="px-1.5 text-grey-400 text-sm">
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
