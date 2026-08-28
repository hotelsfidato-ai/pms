import {
  forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes,
  type ReactNode, useId,
} from "react";
import { cn } from "@/lib/cn";

const FIELD_BASE =
  "w-full bg-white text-ink-900 placeholder:text-grey-400 " +
  "border border-grey-300 rounded-md " +
  "transition-colors duration-150 ease-out " +
  "hover:border-grey-400 " +
  "focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 " +
  "disabled:bg-grey-50 disabled:text-grey-400 disabled:cursor-not-allowed";

const INVALID = "border-brand-red focus:border-brand-red focus:ring-brand-red/20";

/* ── Field wrapper — label, hint, error, all wired for a11y ─────── */

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-grey-700">
          {label}
          {required && <span className="text-brand-red ml-0.5">*</span>}
        </label>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="text-xs text-brand-red">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-grey-500">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Turns what `Field` hands its child into props a DOM element accepts.
 *
 * ⚠️ `describedBy` is camelCase and React will not translate it — a
 * bare `{...props}` spread puts a literal `describedBy` attribute on
 * the input, warns in the console, and silently loses the
 * screen-reader association. Spread this instead.
 */
export function fieldProps(props: {
  id: string;
  describedBy?: string;
  invalid: boolean;
}) {
  return {
    id: props.id,
    "aria-describedby": props.describedBy,
    invalid: props.invalid,
  };
}

/* ── Input ─────────────────────────────────────────────────────── */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  /** Money, counts and dates line up only with tabular figures. */
  numeric?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leadingIcon, trailingSlot, numeric, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD_BASE,
        "h-9 px-3 text-base",
        leadingIcon && "pl-9",
        trailingSlot && "pr-9",
        numeric && "tabular",
        invalid && INVALID,
        className,
      )}
      {...props}
    />
  );

  if (!leadingIcon && !trailingSlot) return field;

  return (
    <div className="relative">
      {leadingIcon && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-400 pointer-events-none [&>svg]:size-4">
          {leadingIcon}
        </span>
      )}
      {field}
      {trailingSlot && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey-400 [&>svg]:size-4">
          {trailingSlot}
        </span>
      )}
    </div>
  );
});

/* ── Textarea ──────────────────────────────────────────────────── */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, "px-3 py-2 text-base resize-y leading-relaxed", invalid && INVALID, className)}
      {...props}
    />
  );
});

/* ── Native select — used where a full Radix Select is overkill ─ */

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, invalid, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          FIELD_BASE,
          "h-9 pl-3 pr-8 text-base appearance-none cursor-pointer",
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2367737e%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')]",
          "bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat",
          invalid && INVALID,
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
