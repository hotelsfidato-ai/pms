import { forwardRef, useId, type ReactNode, type InputHTMLAttributes } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, Minus, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/* ── Avatar ────────────────────────────────────────────────────── */

export function Avatar({
  name, color, size = "md", className,
}: {
  name: string;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "size-5 text-2xs",
    sm: "size-6 text-2xs",
    md: "size-8 text-xs",
    lg: "size-11 text-base",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none",
        sizes[size],
        className,
      )}
      style={{ backgroundColor: color ?? "#67737e" }}
      title={name}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/* ── Checkbox ──────────────────────────────────────────────────────
   A box must say what it ticks to a screen reader, not only to the eye.
   With `label`, the text is tied to the box. Without one, the screen names
   it: an `id` for its own <label htmlFor>, or `aria-label`, or
   `aria-labelledby`. The Channel manager chat found boxes read out as
   "checkbox, not checked" and nothing else (17 September). */

export function Checkbox({
  checked, onCheckedChange, label, disabled, indeterminate, className,
  id, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const labelId = useId();
  const control = (
    <CheckboxPrimitive.Root
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={label ? labelId : ariaLabelledBy}
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={(value) => onCheckedChange?.(value === true)}
      disabled={disabled}
      className={cn(
        "size-4 shrink-0 rounded-xs border border-grey-300 bg-white",
        "transition-colors duration-150 ease-out",
        "hover:border-grey-400",
        "data-[state=checked]:bg-brand-orange data-[state=checked]:border-brand-orange",
        "data-[state=indeterminate]:bg-brand-orange data-[state=indeterminate]:border-brand-orange",
        "disabled:bg-grey-100 disabled:border-grey-200 disabled:cursor-not-allowed",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        {indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return control;

  return (
    <label className={cn("flex items-center gap-2.5 cursor-pointer select-none", disabled && "cursor-not-allowed opacity-60")}>
      {control}
      <span id={labelId} className="text-base text-ink-900">{label}</span>
    </label>
  );
}

/* ── Switch ────────────────────────────────────────────────────── */

export function Switch({
  checked, onCheckedChange, label, description, disabled,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const control = (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full bg-grey-300",
        "transition-colors duration-150 ease-out",
        "data-[state=checked]:bg-success",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-4 rounded-full bg-white shadow-raise",
          "transition-transform duration-150 ease-out",
          "translate-x-0.5 data-[state=checked]:translate-x-[18px]",
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label) return control;

  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer select-none">
      <span className="min-w-0">
        <span className="block text-base text-ink-900">{label}</span>
        {description && <span className="block text-sm text-grey-500 mt-0.5">{description}</span>}
      </span>
      {control}
    </label>
  );
}

/* ── Star rating ───────────────────────────────────────────────── */

export function StarRating({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={`${value} star`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-3",
            i < value ? "fill-brand-yellow text-brand-yellow" : "text-grey-300",
          )}
        />
      ))}
    </span>
  );
}

/* ── Search input — the standard list-screen search ────────────── */

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-grey-400 pointer-events-none"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={ref}
          type="search"
          className={cn(
            "w-full h-9 pl-9 pr-3 text-base bg-white text-ink-900 placeholder:text-grey-400",
            "border border-grey-300 rounded-md",
            "transition-colors duration-150 ease-out",
            "hover:border-grey-400",
            "focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20",
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
          {...props}
        />
      </div>
    );
  },
);

/* ── Segmented control — view switches (list / calendar, etc.) ── */

export function Segmented<T extends string>({
  value, onChange, options, className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-0.5 p-[3px] bg-grey-100 rounded-md", className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            /* 30px is a mouse target (the fidato-design segmented control:
               a 3px track, 7px corners). Under a thumb it grows — see
               Button's SIZES for why this keys off the pointer and
               not the viewport width. */
            "px-3 h-[30px] pointer-coarse:min-h-11 rounded-[7px] text-sm font-medium whitespace-nowrap",
            "press-tile",
            value === opt.value
              ? "bg-white text-ink-900 shadow-[0_1px_2px_rgb(3_23_40/0.08)]"
              /* grey-600: the unselected tab sits on the grey-100 track,
                 where grey-500 measures 4.24:1. */
              : "text-grey-600 hover:text-ink-900",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Progress bar — used by report tables and the wizard ───────── */

export function ProgressBar({
  value, tone = "accent", className,
}: {
  /** 0–100 */
  value: number;
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
  className?: string;
}) {
  const tones = {
    accent: "bg-brand-orange",
    success: "bg-success",
    warning: "bg-brand-yellow",
    danger: "bg-brand-red",
    neutral: "bg-grey-400",
  };
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-grey-100 overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-200 ease-out", tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ── Key/value stat used across dashboards and detail headers ─── */

export function Stat({
  label, value, hint, className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-2xs font-medium uppercase tracking-wide text-grey-500">{label}</p>
      <p className="text-lg font-semibold text-ink-900 tabular mt-1">{value}</p>
      {hint && <p className="text-xs text-grey-500 mt-0.5">{hint}</p>}
    </div>
  );
}

/* ── Icon chip — the tinted square behind a tile's icon ───────────
   The fidato-design chip: a -50 wash, a -100 inset ring and the ink icon.
   Colour only when it means something (today's jobs, money to collect,
   a state); everything else is neutral. `glass` sits on the navy anchor. */

const CHIP_TONES = {
  neutral: "bg-grey-100 text-grey-600",
  orange: "bg-brand-orange-50 text-brand-orange-700 ring-1 ring-inset ring-brand-orange-100",
  yellow: "bg-brand-yellow-50 text-brand-yellow-800 ring-1 ring-inset ring-brand-yellow-100",
  blue: "bg-info-50 text-info ring-1 ring-inset ring-info-100",
  green: "bg-success-50 text-success ring-1 ring-inset ring-success-100",
  glass: "bg-white/10 text-brand-orange",
} as const;

const CHIP_SIZES = {
  28: "size-7 rounded-[8px] [&>svg]:size-4",
  24: "size-6 rounded-[7px] [&>svg]:size-3.5",
  20: "size-5 rounded-[6px] [&>svg]:size-3",
} as const;

export function IconChip({
  tone = "neutral", size = 28, children, className,
}: {
  tone?: keyof typeof CHIP_TONES;
  size?: keyof typeof CHIP_SIZES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("grid place-items-center shrink-0", CHIP_SIZES[size], CHIP_TONES[tone], className)}
    >
      {children}
    </span>
  );
}

/* ── Separator ─────────────────────────────────────────────────── */

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px bg-grey-200", className)} role="separator" />;
}
