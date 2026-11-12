import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   ONE PRICE CHANGE ACROSS PROPERTIES (D27-383 item 6)

   The server's api/src/modules/inventory/groupRates.ts: what would change
   at each property (writes nothing), then the same question saved, every
   property or none. The save sends back what the person was shown; the
   server refuses it if anything has moved since.
   ══════════════════════════════════════════════════════════════════ */

export type ChangeKind = "set" | "by" | "percent";

export interface RateChangeQuestion {
  hotels: string[];
  roomType: string;
  /** The first and the last day, both changed. */
  from: string;
  through: string;
  kind: ChangeKind;
  value: number;
}

/** A run of days with one old and one new base. old null: nobody priced it (a dash). */
export interface RateRun { from: string; through: string; old: number | null; new: number | null }

export interface RatePlan {
  code: string;
  name: string;
  /** The room type matched by name here, as this property spells it; null when none. */
  roomType: { id: string; name: string; code: string } | null;
  /** Why nothing is changed here; null when its runs are saved. */
  skipped: string | null;
  runs: RateRun[];
}

export interface RateChangePreview {
  /** Every room type name at the properties chosen, and which have it. */
  roomTypes: { name: string; at: string[] }[];
  /** Absent until the question is whole. */
  hotels?: RatePlan[];
  /** What is still missing from the question, in a sentence. */
  problem?: string | null;
}

export function previewRateChange(q: Partial<RateChangeQuestion> & { hotels: string[] }) {
  const params = new URLSearchParams({ hotels: q.hotels.join(",") });
  for (const k of ["roomType", "from", "through", "kind", "value"] as const) {
    if (q[k] !== undefined && q[k] !== "") params.set(k, String(q[k]));
  }
  return api<RateChangePreview>(`/api/group/rate-change?${params}`);
}

export type SaveResult =
  | { ok: true; saved: { code: string; name: string }[]; skipped: { code: string; name: string; reason: string }[] }
  | { ok: false; reason: string };

/** Saves what was shown, at every property, or nothing. */
export async function saveRateChange(q: RateChangeQuestion, seen: RatePlan[]): Promise<SaveResult> {
  try {
    return await api<SaveResult>("/api/group/rate-change", {
      method: "POST", body: JSON.stringify({ ...q, seen }),
    });
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: error.message };
    throw error;
  }
}
