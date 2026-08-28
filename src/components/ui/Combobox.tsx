import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Popover, PopoverTrigger, PopoverContent } from "./Overlays";
import { describeError } from "./States";

/* ══════════════════════════════════════════════════════════════════
   COMBOBOX
   Searchable single-select. Used wherever the option list is long
   enough that a plain <select> stops being usable — customers,
   companies, properties, room types.
   ══════════════════════════════════════════════════════════════════ */

export interface ComboboxOption<T = string> {
  value: T;
  label: string;
  /** Second line — email, city, whatever disambiguates. */
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps<T extends string> {
  value?: T;
  onChange: (value: T) => void;
  options: ComboboxOption<T>[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  /** Rendered above the list — e.g. a "Create new" affordance. */
  footer?: ReactNode;
  /**
   * ⚠️ Pass these whenever the options come from a query.
   *
   * Without them an empty list is indistinguishable from a failed one:
   * a picker that says "No matches." while the fetch is erroring sends
   * you looking for missing records that are sitting in the database.
   * That mistake cost several rounds of debugging on the customer
   * picker, which is why they are separate states now.
   */
  loading?: boolean;
  error?: unknown;
}

export function Combobox<T extends string>({
  value, onChange, options, placeholder = "Select…",
  searchPlaceholder = "Search…", emptyMessage = "No matches.",
  disabled, invalid, id, className, footer, loading, error,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return options.slice(0, 100);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.description?.toLowerCase().includes(needle),
      )
      .slice(0, 100);
  }, [options, term]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTerm("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex items-center justify-between gap-2 w-full h-9 px-3 text-base text-left",
            "bg-white border border-grey-300 rounded-md",
            "transition-colors duration-150 ease-out",
            "hover:border-grey-400",
            "focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20",
            "disabled:bg-grey-50 disabled:text-grey-400 disabled:cursor-not-allowed",
            invalid && "border-brand-red focus:border-brand-red focus:ring-brand-red/20",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-grey-400")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 text-grey-400 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0 overflow-hidden"
        align="start"
      >
        <div className="flex items-center gap-2 px-3 h-9 border-b border-grey-200">
          <Search className="size-3.5 text-grey-400 shrink-0" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="flex-1 min-w-0 text-base bg-transparent outline-none placeholder:text-grey-400"
          />
        </div>

        {/* Listbox semantics: the trigger is a Popover, so without these
            roles a screen reader hears a dialog full of buttons rather
            than a set of choices. */}
        <div role="listbox" className="max-h-64 overflow-y-auto scrollbar-quiet p-1">
          {error ? (
            /* The reason, verbatim where Firestore gives one. An
               internal tool's user is the person who reports the bug. */
            <div className="px-3 py-5 text-center">
              <p className="text-sm font-medium text-brand-red">
                {describeError(error).title ?? "Could not load the list"}
              </p>
              <p className="text-sm text-grey-500 mt-1 leading-relaxed">
                {describeError(error).message ?? "Nothing was loaded."}
              </p>
            </div>
          ) : loading ? (
            <p className="px-3 py-6 text-center text-sm text-grey-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-grey-500">{emptyMessage}</p>
          ) : (
            filtered.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setTerm("");
                }}
                className={cn(
                  "flex items-start gap-2.5 w-full px-2.5 py-2 rounded-sm text-left",
                  "transition-colors duration-150",
                  "hover:bg-grey-100 focus:bg-grey-100 outline-none",
                  "disabled:text-grey-400 disabled:hover:bg-transparent disabled:cursor-not-allowed",
                )}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0 mt-0.5 text-brand-orange",
                    opt.value === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-ink-900 truncate">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-sm text-grey-500 truncate">{opt.description}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        {footer && <div className="border-t border-grey-200 p-1">{footer}</div>}
      </PopoverContent>
    </Popover>
  );
}
