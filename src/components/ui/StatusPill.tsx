import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   STATUS PILL
   Colour carries meaning here and almost nowhere else in the UI.
   Each tone is a soft tint with a readable ink, never a solid block.
   ══════════════════════════════════════════════════════════════════ */

export type Tone =
  | "neutral"   // draft, inactive, unremarkable
  | "info"      // in progress, in-house
  | "success"   // confirmed, paid, completed
  | "warning"   // pending, awaiting action
  | "danger"    // overdue, failed, cancelled
  | "accent";   // brand-highlighted, VIP

const TONES: Record<Tone, string> = {
  neutral: "bg-grey-100 text-grey-600 ring-grey-200",
  info: "bg-info-50 text-info ring-info-100",
  success: "bg-success-50 text-success-600 ring-success-100",
  warning: "bg-brand-yellow-50 text-[#8a6300] ring-brand-yellow-100",
  danger: "bg-brand-red-50 text-brand-red ring-brand-red-100",
  accent: "bg-brand-orange-50 text-brand-orange-700 ring-brand-orange-100",
};

export interface StatusPillProps {
  tone?: Tone;
  children: ReactNode;
  /** Small leading dot — helps the eye group a column of statuses. */
  dot?: boolean;
  className?: string;
}

const DOT_TONES: Record<Tone, string> = {
  neutral: "bg-grey-400",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-brand-yellow",
  danger: "bg-brand-red",
  accent: "bg-brand-orange",
};

export function StatusPill({ tone = "neutral", children, dot = true, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
        "text-2xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full shrink-0", DOT_TONES[tone])} />}
      {children}
    </span>
  );
}

/* ── Domain status → tone maps ─────────────────────────────────────
   Kept beside the pill so a status can never be coloured two
   different ways in two different screens.                        */

export const RESERVATION_TONES: Record<string, Tone> = {
  draft: "neutral",
  pending_approval: "warning",
  confirmed: "success",
  checked_in: "info",
  completed: "neutral",
  cancelled: "danger",
  no_show: "danger",
};

export const INVOICE_TONES: Record<string, Tone> = {
  draft: "neutral",
  sent: "info",
  partially_paid: "warning",
  paid: "success",
  overdue: "danger",
  void: "neutral",
};

export const HOTEL_TONES: Record<string, Tone> = {
  active: "success",
  onboarding: "info",
  paused: "warning",
};

export const CUSTOMER_TONES: Record<string, Tone> = {
  active: "success",
  lead: "info",
  inactive: "neutral",
};

export const COMPANY_TONES: Record<string, Tone> = {
  active: "success",
  prospect: "info",
  dormant: "neutral",
};

export const AUTOMATION_TONES: Record<string, Tone> = {
  active: "success",
  paused: "warning",
  draft: "neutral",
};

export const RUN_TONES: Record<string, Tone> = {
  success: "success",
  failed: "danger",
  running: "info",
};

export const COMMISSION_TONES: Record<string, Tone> = {
  accrued: "neutral",
  approved: "info",
  paid: "success",
};

export const INTEGRATION_TONES: Record<string, Tone> = {
  connected: "success",
  available: "neutral",
  error: "danger",
};

/* ── PMS-specific tone maps ────────────────────────────────────────
   Added for the Property Management System. CRS sets kept above
   to maintain diff-ability against the origin file.              */

export const ROOM_TONES: Record<string, Tone> = {
  clean: "success",
  dirty: "warning",
  inspected: "success",
  "out-of-order": "danger",
  "out-of-service": "neutral",
};

export const STAY_TONES: Record<string, Tone> = {
  "due-in": "info",
  "in-house": "success",
  "due-out": "warning",
  "checked-out": "neutral",
  "no-show": "danger",
};

export const HOUSEKEEPING_TONES: Record<string, Tone> = {
  assigned: "info",
  "in-progress": "warning",
  done: "success",
  blocked: "danger",
};

export const FOLIO_TONES: Record<string, Tone> = {
  open: "info",
  settled: "success",
  disputed: "warning",
  "written-off": "danger",
};
