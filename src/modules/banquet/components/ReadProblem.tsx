import { Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { timeOnly } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   REFUSED, UNREACHABLE, OR FAILED — BQ-3

   The banquet reads used to answer null on any failure, and every
   screen read null as "the module is off": a server fault told a GM
   at a property with a hall "This property has no banquet hall".

   The owner's answer, 17 September: say it the way the restaurant
   screens already do (POS-4). So the logic and the words below are the
   till's `src/modules/pos/components/ReadProblem.tsx`, on purpose.

   ⚠ A SECOND COPY, AND NAMED AS ONE. It is here because a service may
   not import another service's components (boundaries.test.ts). The
   request to move one copy into the shared kit is in this service's
   MODULE.md, "Requests" — until then, a change to the words in one file
   is a change to make in both.

     refused       the server answered no, with a sentence — shown as it is
     unreachable   nothing arrived at the server
     failed        the server answered with a fault
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

/** The query's failure — or, when React Query has PAUSED the read because
    the device says it is offline, that same "could not reach the server".
    A paused read has no error and no data, and a screen that only branched
    on the error drew nothing at all (front desk found it on /stay). */
export function readError(q: { error: unknown; isPaused: boolean }): unknown {
  if (q.error) return q.error;
  return q.isPaused ? new ApiError(0, "Could not reach the server.") : null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** In place of a screen that has nothing to show because its read did
    not succeed. `what` is how the screen names the thing: "the diary",
    "this function". */
export function ReadFailed({ error, what, onRetry, className }: {
  error: unknown;
  what: string;
  onRetry: () => void;
  className?: string;
}) {
  const problem = readProblem(error);
  if (!problem) return null;

  if (problem.kind === "refused") {
    return (
      <EmptyState
        className={className}
        icon={<Lock />}
        title={`${capital(what)} is not available`}
        description={problem.reason}
      />
    );
  }

  return (
    <ErrorState
      className={className}
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
