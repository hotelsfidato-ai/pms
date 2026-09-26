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
  /* Solid brand orange — one primary action per view.

     THE FILL IS orange-600, NOT orange. White on #df6128 is 3.57:1,
     which fails AA for a 14px label — and the old hover step darkened
     it to 4.59:1, so the button became readable only while the pointer
     was on it, and never on a touch screen. Measured 16 September. */
  primary:
    "bg-brand-orange-600 text-white hover:bg-brand-orange-700 active:bg-brand-orange-800 disabled:bg-grey-300 disabled:text-grey-600",
  /* A DISABLED LABEL STAYS READABLE — grey-500 on grey-50 is 4.56:1,
     where grey-400 was 2.43:1. This product explains every disabled
     control in words (StayActions, MenuItem's `reason`); a label
     nobody can read is a poor place to start that sentence. */
  // The workhorse. Hairline border, not a shadow.
  secondary:
    "bg-white text-ink-900 border border-grey-300 hover:bg-grey-50 hover:border-grey-400 active:bg-grey-100 disabled:text-grey-500 disabled:bg-grey-50",
  ghost:
    "text-grey-600 hover:bg-grey-100 hover:text-ink-900 active:bg-grey-200 disabled:text-grey-500",
  danger:
    "bg-brand-red text-white hover:bg-brand-red-700 active:bg-brand-red-800 disabled:bg-grey-300",
  /* orange-700, not orange: #df6128 on white is 3.57:1 (D22-12). */
  link: "text-brand-orange-700 hover:text-brand-orange-800 hover:underline underline-offset-4 p-0 h-auto",
};

/* `pointer-coarse:` and not `sm:`, because the thing that makes a
   control hard to press is the FINGER, not the window width. A 32px
   button is fine in a narrow desktop window and miss-prone on a phone,
   and the browser already knows which one it is.

   Found by measuring rather than by looking: every button on the
   invoices screen came out at 32px on a 375px viewport — sixty of
   them, all the primary action of the page. `min-height` beats
   `height` in the cascade, so the row keeps its desktop density and
   grows to 44px under a thumb. */
const TOUCH = "pointer-coarse:min-h-11";

/* Capsules, every size (the owner, 27 September: one button shape across
   the app, the fidato-design look). Colours and heights are unchanged. */
const SIZES: Record<ButtonSize, string> = {
  sm: `h-8 px-3 text-sm gap-1.5 rounded-full ${TOUCH}`,
  md: `h-9 px-3.5 text-base gap-2 rounded-full ${TOUCH}`,
  lg: "h-11 px-5 text-md gap-2 rounded-full",
  icon: `h-9 w-9 rounded-full ${TOUCH} pointer-coarse:min-w-11`,
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
    variant === "link" ? "transition-colors duration-150 ease-out" : "press",
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
      <Slot ref={ref} className={styles} data-variant={variant} {...props}>
        {merged}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={styles}
      /* What the button MEANS, readable by a test. "One primary action per
         screen" (the clarity plan, step 2) was a rule nothing could check:
         3 of 282 buttons had asked to be primary and nobody knew. */
      data-variant={variant}
      {...props}
    >
      {leading}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
