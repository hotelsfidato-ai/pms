import type { ReactNode } from "react";
import { AlertCircle, RotateCw, SearchX, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

/* ══════════════════════════════════════════════════════════════════
   EMPTY / LOADING / ERROR
   Every list screen ships all four states. They live here so they
   read identically everywhere.
   ══════════════════════════════════════════════════════════════════ */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** Compact variant for inside cards and table bodies. */
  compact?: boolean;
}

export function EmptyState({
  icon, title, description, action, className, compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-10 px-6" : "py-16 px-6",
        className,
      )}
    >
      <div className="flex items-center justify-center size-11 rounded-full bg-grey-100 text-grey-400 mb-4 [&>svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      <p className="text-md font-semibold text-ink-900">{title}</p>
      {description && (
        <p className="text-base text-grey-500 mt-1.5 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Distinct from EmptyState: there IS data, the filters just exclude it all. */
export function NoResultsState({
  onClear, className,
}: {
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      compact
      className={className}
      icon={<SearchX />}
      title="No matches"
      description="Nothing matches the current search and filters. Try widening them."
      action={
        onClear && (
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        )
      }
    />
  );
}

/**
 * ⚠️ Shows the real error, not a reassuring sentence.
 *
 * "This is usually temporary" was actively misleading: the failure it
 * hid most often was a missing Firestore composite index, which is
 * permanent and needs a one-line fix. Retrying forever was the only
 * thing the old copy suggested.
 *
 * This is an internal back office. The people who see an error are the
 * people who report it, so the message they can read is worth more
 * than a tidy one they cannot act on.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const detail = describeError(error);
  const body =
    description ?? detail.message ?? "The data could not be loaded.";

  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-14 px-6", className)}>
      <div className="flex items-center justify-center size-11 rounded-full bg-brand-red-50 text-brand-red mb-4">
        <AlertCircle className="size-5" />
      </div>
      <p className="text-md font-semibold text-ink-900">{detail.title ?? title}</p>
      <p className="text-base text-grey-500 mt-1.5 max-w-md leading-relaxed">{body}</p>

      {detail.indexUrl && (
        <a
          href={detail.indexUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 text-sm text-brand-orange hover:underline font-medium"
        >
          Create the missing index in Firebase →
        </a>
      )}
      {onRetry && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-5"
          onClick={onRetry}
          leadingIcon={<RotateCw className="size-4" />}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/* ── Skeletons ─────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-grey-200/70", className)}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Matches the DataTable's row rhythm so the swap doesn't jump. */
export function SkeletonTable({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="flex items-center gap-4 px-4 h-10 border-b border-grey-200 bg-grey-50">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1 max-w-[120px]" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 h-[52px] border-b border-grey-100">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-3.5 flex-1", c === 0 ? "max-w-[180px]" : "max-w-[110px]")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-grey-200 rounded-md p-5">
          <Skeleton className="h-4 w-1/2 mb-3" />
          <Skeleton className="h-3 w-1/3 mb-5" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

/* ── Inline spinner ────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin size-4 text-grey-400", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Error interpretation ──────────────────────────────────────────
   Firestore's errors carry the fix inside the message. Pulling it out
   turns a dead end into a next step.                                */

interface ErrorDetail {
  title?: string;
  message?: string;
  /** Firestore's own "create this index" console link, when present. */
  indexUrl?: string;
}

export function describeError(error: unknown): ErrorDetail {
  if (!error) return {};
  const raw = error instanceof Error ? error.message : String(error);

  /* ⚠️ The one we have already been bitten by. A query filtering on one
     field and ordering by another throws until the index exists, and
     Firestore helpfully includes a link that builds it. */
  const indexUrl = raw.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/)?.[0];
  if (raw.includes("requires an index") || indexUrl) {
    return {
      title: "This list needs a database index",
      message:
        "Firestore cannot sort these records without one. Create it from the link " +
        "below, then add it to firestore.indexes.json so the next deploy keeps it.",
      indexUrl,
    };
  }

  if (raw.includes("Missing or insufficient permissions")) {
    return {
      title: "You do not have access to this",
      message:
        "The security rules refused this read. If you should be able to see it, your " +
        "role needs changing — an administrator can do that from Admin → Users.",
    };
  }

  if (raw.includes("offline") || raw.includes("Failed to get document because the client is offline")) {
    return {
      title: "No connection",
      message: "The app cannot reach Firestore. Check the network and try again.",
    };
  }

  return { message: raw };
}
