import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";

/* ══════════════════════════════════════════════════════════════════
   MANAGER REPORT — over HTTP, as of CP9e

   Three columns throughout: Today · PTD · YTD. PTD is the period to
   date; YTD runs from 1 April, the Indian financial year.

   Every figure is derived in SQL, and the eight that are NOT derivable
   come back as `null` — which prints as an em-dash. Each is a real
   gap: an opening balance nothing predates, a POS bridge that does not
   exist, commission charged outside this system. An invented zero on a
   report an owner reads is worse than a visible gap.

   The three windows share one derivation on the server. Computing them
   separately is how a report ends up saying today's revenue is not
   part of the period's.
   ══════════════════════════════════════════════════════════════════ */

/* `FY_START = "2026-04-01"` lived here (REP-2) and nothing read it: the
   report's year start has always come back from the server as `ytdFrom`.
   Removed rather than corrected — a second copy of the financial year is
   how two screens come to disagree about it. The one rule is
   financialYearStart() in api/src/modules/reports/manager.ts. */

export interface ThreeColumn {
  label: string;
  /** `null` means not derivable — the interface prints a dash. */
  today: number | null;
  ptd: number | null;
  ytd: number | null;
  total?: boolean;
  indent?: boolean;
  /** Set on the Statistics rows, which are neither counts nor sections of
      money: a rate in rupees, or a percentage. */
  unit?: "money" | "percent";
}

export interface ManagerReportSection {
  title: string;
  rows: ThreeColumn[];
  /** Printed under the section, from the real report's own footnotes. */
  note?: string;
}

export interface ManagerReport {
  asOn: string;
  ptdFrom: string;
  ytdFrom: string;
  currency: string;
  sections: ManagerReportSection[];
  /** Room Summary and Statistics are counts, not money. */
  roomSummary: ThreeColumn[];
  statistics: ThreeColumn[];
  footnotes: string[];
}

export async function getManagerReport(
  hotelId: string,
  asOn = BUSINESS_DATE,
  /* ⚠ WAS THE LITERAL "2026-08-01". Correct on every day of August 2026
     and wrong on every other: the period-to-date column would have run
     from the first of August whatever month the report was for. The
     first of THE REPORT'S OWN MONTH — the window the API itself uses
     when none is sent. Found 14 September building the Dashboard. */
  ptdFrom = `${asOn.slice(0, 7)}-01`,
): Promise<ManagerReport | null> {
  if (!hotelId) return null;
  try {
    return await api<ManagerReport>(
      `/api/hotels/${hotelId}/reports/manager` +
        `?asOn=${encodeURIComponent(asOn)}&ptdFrom=${encodeURIComponent(ptdFrom)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
