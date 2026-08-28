import {
  Children, cloneElement, forwardRef, isValidElement,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  // Solid brand orange — one primary action per view.
  primary:
    "bg-brand-orange text-white hover:bg-brand-orange-600 active:bg-brand-orange-700 disabled:bg-grey-300 disabled:text-grey-500",
  // The workhorse. Hairline border, not a shadow.
  secondary:
    "bg-white text-ink-900 border border-grey-300 hover:bg-grey-50 hover:border-grey-400 active:bg-grey-100 disabled:text-grey-400 disabled:bg-grey-50",
  ghost:
    "text-grey-600 hover:bg-grey-100 hover:text-ink-900 active:bg-grey-200 disabled:text-grey-400",
  danger:
    "bg-brand-red text-white hover:bg-[#c22718] active:bg-[#a82115] disabled:bg-grey-300",
  link: "text-brand-orange hover:text-brand-orange-600 hover:underline underline-offset-4 p-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-sm",
  md: "h-9 px-3.5 text-base gap-2 rounded-md",
  lg: "h-11 px-5 text-md gap-2 rounded-md",
  icon: "h-9 w-9 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render as the child element (e.g. a router Link) instead of a <button>. */
  asChild?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    asChild = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const styles = cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap",
    "transition-colors duration-150 ease-out",
    "disabled:cursor-not-allowed",
    variant !== "link" && SIZES[size],
    VARIANTS[variant],
    className,
  );

  const leading = loading ? (
    <Loader2 className="size-4 animate-spin" aria-hidden />
  ) : (
    leadingIcon
  );

  /* Radix Slot accepts exactly one child, so when rendering as a Link
     the icons have to go *inside* that element rather than beside it.
     `disabled` is dropped too — it is not a valid anchor attribute. */
  if (asChild) {
    const child = Children.only(children) as ReactElement<{ children?: ReactNode }>;
    const merged = isValidElement(child)
      ? cloneElement(child, undefined, leading, child.props.children, !loading && trailingIcon)
      : child;

    return (
      <Slot ref={ref} className={styles} {...props}>
        {merged}
      </Slot>
    );
  }

  return (
    <button ref={ref} disabled={disabled || loading} className={styles} {...props}>
      {leading}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
