import type { ReactNode } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { humanise } from "@/lib/format";
import { SearchInput } from "./Misc";
import { Button } from "./Button";
import { NativeSelect } from "./Input";

/* ══════════════════════════════════════════════════════════════════
   FILTER BAR
   Search on the left, filters beside it, actions on the right.
   Active filters appear as removable chips underneath so it is
   always obvious why a list is short.
   ══════════════════════════════════════════════════════════════════ */

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  values?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  onClear?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function FilterBar({
  search, onSearchChange, searchPlaceholder = "Search…",
  filters = [], values = {}, onFilterChange, onClear, actions, className,
}: FilterBarProps) {
  const active = Object.entries(values).filter(
    ([, value]) => value && value !== "all",
  );
  const hasAny = active.length > 0 || search.trim().length > 0;

  return (
    <div className={cn("mb-4", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full sm:w-72"
        />

        {filters.map((filter) => (
          <NativeSelect
            key={filter.key}
            value={values[filter.key] ?? "all"}
            onChange={(e) => onFilterChange?.(filter.key, e.target.value)}
            aria-label={filter.label}
            className="w-auto min-w-[130px]"
          >
            <option value="all">{filter.label}: All</option>
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect>
        ))}

        {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
      </div>

      {hasAny && (
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <SlidersHorizontal className="size-3.5 text-grey-400" />

          {search.trim() && (
            <Chip label={`“${search.trim()}”`} onRemove={() => onSearchChange("")} />
          )}

          {active.map(([key, value]) => {
            const filter = filters.find((f) => f.key === key);
            const option = filter?.options.find((o) => o.value === value);
            return (
              <Chip
                key={key}
                label={`${filter?.label ?? humanise(key)}: ${option?.label ?? humanise(value)}`}
                onRemove={() => onFilterChange?.(key, "all")}
              />
            );
          })}

          {onClear && (
            <Button variant="link" size="sm" onClick={onClear} className="text-sm">
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 pl-2.5 pr-1.5 rounded-full bg-grey-100 text-xs text-grey-700">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="text-grey-400 hover:text-ink-900 transition-colors duration-150"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
