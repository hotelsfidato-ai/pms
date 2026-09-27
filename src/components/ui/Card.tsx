import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* Surfaces are white on a grey page, separated by a hairline border.
   12px corners and the Rhythm Rule inside (fidato-design, 27 Sep):
   16px at the sides, 14px top and bottom. One value at every width:
   a responsive one would outlive a screen's own `p-0` (twMerge keeps
   modified classes).
   Shadows are reserved for things that float above the page. */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      /* A table placed straight in a card lets the card draw the frame:
         both drew one, and fourteen screens showed a doubled hairline. */
      className={cn("bg-white border border-grey-200 rounded-lg [&>[data-table-frame]]:border-0", className)}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function CardHeader({
  title, description, actions, className, children, ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-4 py-3.5 border-b border-grey-200",
        className,
      )}
      {...props}
    >
      {children ?? (
        <div className="min-w-0">
          {title && <h3 className="text-md font-semibold text-ink-900 truncate">{title}</h3>}
          {description && <p className="text-sm text-grey-500 mt-0.5">{description}</p>}
        </div>
      )}
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3.5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 px-4 py-3.5 border-t border-grey-200 bg-grey-50 rounded-b-lg",
        className,
      )}
      {...props}
    />
  );
}

/* ── Definition list — the standard detail-screen field layout ─── */

export function DetailList({ className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return <dl className={cn("divide-y divide-grey-100", className)} {...props} />;
}

export function DetailRow({
  label, children, className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(120px,180px)_1fr] gap-4 py-2.5", className)}>
      <dt className="text-sm text-grey-500">{label}</dt>
      <dd className="text-base text-ink-900 min-w-0">{children}</dd>
    </div>
  );
}
