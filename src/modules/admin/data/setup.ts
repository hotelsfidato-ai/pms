import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { put } from "@/data/repositories/http";
import type { StepId } from "@/modules/admin/setup/steps";

/* ══════════════════════════════════════════════════════════════════
   SET UP THIS HOTEL - the two calls (the owner's D27-311)

   GET gives every step's state as the SERVER works it out from what the
   PMS can see (`automatic`: true = derived, never ticked by hand). PUT
   records the person's own choice for a step. The refusal is the server's
   sentence, as a value, like every other write in this folder.
   ══════════════════════════════════════════════════════════════════ */

export type StepState = "done" | "todo" | "later" | "remind";

export interface SetupStepState {
  id: StepId;
  state: StepState;
  /** True: derived by the server, so there is no "Completed" to press. */
  automatic: boolean;
  /** What is still missing, in words. */
  detail: string | null;
  /** YYYY-MM-DD, when state is "remind". */
  remindOn: string | null;
  by: string | null;
  at: string | null;
}

export interface SetupView {
  steps: SetupStepState[];
  /** Steps 1 to 5 are done. */
  ready: boolean;
}

export type StepChoice =
  | { choice: "completed" | "later" | "clear" }
  | { choice: "remind"; remindOn: string };

const at = (code: string, rest = "") => `/api/hotels/${encodeURIComponent(code)}/setup${rest}`;

export const SETUP_KEY = (code: string) => ["setup", code] as const;

export const getSetup = (code: string) => api<SetupView>(at(code));

export const chooseStep = (code: string, id: StepId, choice: StepChoice): Promise<AdminResult<object>> =>
  put(at(code, `/${id}`), choice);

/** The view, for whoever may see it. A failed read is the caller's to show. */
export function useSetup(code: string, enabled = true) {
  return useQuery({
    queryKey: SETUP_KEY(code),
    queryFn: () => getSetup(code),
    enabled: enabled && Boolean(code),
  });
}

/** The steps a person parked: Later, or Remind me. */
export const waiting = (view: SetupView | undefined): SetupStepState[] =>
  view?.steps.filter((s) => s.state === "later" || s.state === "remind") ?? [];
