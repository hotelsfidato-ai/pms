import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   PAGE HEADER
   Every screen opens the same way: where you are, what this is,
   and what you can do about it. Generous space above the title is
   what makes the app read calm rather than cramped.
   ══════════════════════════════════════════════════════════════════ */

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm min-w-0", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
            {item.to && !last ? (
              <Link
                to={item.to}
                className="text-grey-500 hover:text-ink-900 transition-colors duration-150 truncate"
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn("truncate", last ? "text-grey-600" : "text-grey-500")}>
                {item.label}
              </span>
            )}
            {!last && <ChevronRight className="size-3.5 text-grey-300 shrink-0" />}
          </span>
        );
      })}
    </nav>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /** Status pill or similar, shown inline beside the title. */
  badge?: ReactNode;
  /** Tabs or a filter row that belongs to the header block. */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title, description, breadcrumbs, actions, badge, children, className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} className="mb-2.5" />
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-semibold text-ink-900 truncate">{title}</h1>
            {badge}
          </div>
          {description && (
            <p className="text-base text-grey-500 mt-1.5 max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>

      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

/* ── Page container — the one place page padding is defined ────── */

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-5 py-6 sm:px-7 sm:py-8 max-w-[1600px] mx-auto", className)}>
      {children}
    </div>
  );
}

/* ── Section — a titled block inside a page ────────────────────── */

export function Section({
  title, description, actions, children, className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-8 last:mb-0", className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4 mb-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-ink-900">{title}</h2>}
            {description && <p className="text-sm text-grey-500 mt-1">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
