/* The two shapes a write answers with, shared by every service's data
   files. Moved here from operations.ts and admin.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); unchanged. Core. */

export interface OperationResult<T = void> {
  ok: boolean;
  reason?: string;
  /** What would SATISFY this refusal, when it has an answer. A screen
      opens the right dialog from this rather than matching on the
      prose — which somebody will reword one day, at which point the
      way through silently disappears. */
  needs?: "late-reason" | "early-reason" | "credit-limit" | "next-destination";
  data?: T;
}

export const refuse = (reason: string): OperationResult<never> => ({ ok: false, reason });

export type AdminResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };
