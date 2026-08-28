import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* Surfaces are white on a grey page, separated by a hairline border.
   Shadows are reserved for things that float above the page. */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-white border border-grey-200 rounded-md", className)}
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
        "flex items-start justify-between gap-4 px-5 py-4 border-b border-grey-200",
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
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 px-5 py-3.5 border-t border-grey-200 bg-grey-50 rounded-b-md",
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
