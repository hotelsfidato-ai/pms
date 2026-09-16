import { Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { timeOnly } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   REFUSED, FAILED, OR EMPTY — POS-4

   The till's reads used to end in `catch { return [] }`, so every
   failure arrived at the screen as an empty answer: a server fault on
   the day end read "This property has no restaurant configured", and
   the kitchen board read "Nothing ordered yet" while nothing had
   loaded at all. PosGate (MEMORY 251) caught the refusal before a
   screen drew; nothing caught the fault.

   The reads throw now, and a screen asks this file what went wrong.
   EMPTY is not in here: an empty list is a read that SUCCEEDED, and it
   keeps the words each screen already has for it.

     refused       the server answered no, with a sentence — shown as it is
     unreachable   nothing arrived at the server
     failed        the server answered with a fault

   ⚠ A FAILED REFRESH KEEPS WHAT WAS THERE. React Query leaves the last
   good answer in `data` when a refetch throws, so a screen with
   something to show goes on showing it — and says, with `ReadStale`,
   that it is not current. Only a screen with NOTHING to show draws
   `ReadFailed` in its place.
   ══════════════════════════════════════════════════════════════════ */

export type ReadProblemKind =
  | { kind: "refused"; reason: string }
  | { kind: "unreachable" }
  | { kind: "failed"; status: number | null; message: string };

export function readProblem(error: unknown): ReadProblemKind | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    /* 0 is what `api()` throws when the request never arrived. */
    if (error.status === 0) return { kind: "unreachable" };
    if (error.status >= 400 && error.status < 500) {
      return { kind: "refused", reason: error.message };
    }
    return { kind: "failed", status: error.status, message: error.message };
  }
  return {
    kind: "failed", status: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** In place of a list or a board that has nothing to show because its
    read did not succeed. `what` is how the screen names the thing:
    "the menu", "today's orders", "this bill". */
export function ReadFailed({ error, what, onRetry, compact, className }: {
  error: unknown;
  what: string;
  onRetry: () => void;
  compact?: boolean;
  className?: string;
}) {
  const problem = readProblem(error);
  if (!problem) return null;

  if (problem.kind === "refused") {
    return (
      <EmptyState
        compact={compact}
        className={className}
        icon={<Lock />}
        title={`${capital(what)} is not available`}
        description={problem.reason}
      />
    );
  }

  return (
    <ErrorState
      className={cn(compact && "py-8", className)}
      title={`${capital(what)} did not load`}
      description={
        problem.kind === "unreachable"
          ? "The server could not be reached, and this device has no saved copy to show. Check the connection, then try again."
          : problem.status
            ? `The server answered with an error (${problem.status}). Try again, and tell the manager if it keeps happening.`
            : `${problem.message}. Try again, and tell the manager if it keeps happening.`
      }
      onRetry={onRetry}
    />
  );
}

/** A line above something that IS shown, when the last attempt to
    refresh it failed. `loadedAt` is the query's `dataUpdatedAt`. */
export function ReadStale({ error, loadedAt, onRetry, className }: {
  error: unknown;
  loadedAt: number;
  onRetry: () => void;
  className?: string;
}) {
  const problem = readProblem(error);
  if (!problem) return null;

  const cause =
    problem.kind === "unreachable" ? "no connection"
      : problem.kind === "refused" ? `refused — ${problem.reason}`
        : problem.status ? `the server answered with an error (${problem.status})`
          : problem.message;

  return (
    <div
      role="status"
      data-read-stale=""
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3.5 py-2",
        "border-brand-yellow-100 bg-brand-yellow-50",
        className,
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-[#8a6300]" />
      <p className="text-sm text-[#8a6300] min-w-0">
        Not up to date: {cause}.
        {loadedAt > 0 && ` Showing what loaded at ${timeOnly(new Date(loadedAt))}.`}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium text-[#8a6300] underline underline-offset-2 hover:no-underline cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}
