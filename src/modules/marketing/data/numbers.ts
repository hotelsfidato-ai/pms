import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   MARKETING NUMBERS — the seam (D27-168, D27-170)

   One month, by the stays' arrival date. Spend and the campaigns' names
   are read live from the leads app; bookings and revenue are this
   system's own stays (reservations.campaign, and the booking source).
   Revenue is room charges before tax, the reports' own definition, with
   cancelled and no-show stays out. A figure nobody has is null: a dash.
   ══════════════════════════════════════════════════════════════════ */

export interface CampaignLine {
  /** The leads app's campaign key, the same one a booking keeps. */
  key: string;
  name: string | null;
  platform: string | null;
  /** From the leads app. Null: not read, or no spend recorded that month. */
  spend: number | null;
  bookings: number;
  /** Numeric text from the database; null where no stay has a charge. */
  revenue: string | null;
}

export interface SourceLine {
  id: string | null;
  /** Null for stays with no source recorded. */
  name: string | null;
  bookings: number;
  revenue: string | null;
}

export interface MarketingNumbers {
  month: string;
  connected: boolean;
  inApp: boolean;
  /** The server's sentence when the leads app was not read this time. */
  appError: string | null;
  campaigns: CampaignLine[];
  sources: SourceLine[];
}

export function getNumbers(code: string, month: string): Promise<MarketingNumbers> {
  return api<MarketingNumbers>(`/api/hotels/${code}/marketing/numbers?month=${month}`);
}
