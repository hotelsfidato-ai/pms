import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   EMAIL A REPORT, AND REPORTS ON A SCHEDULE (D27-383 item 5) - the seam

   The server decides who may (the report's own read rule; the schedules:
   the owner, an Administrator or the GM), what may be scheduled with which
   period, and every refusal's words (api/src/modules/reports/emails.ts).
   ══════════════════════════════════════════════════════════════════ */

export type FileType = "pdf" | "xlsx";

export interface EmailInfo {
  /** The addresses the hotel's report emails already go to, to pick from. */
  recipients: string[];
  /** The sender's sentence where nothing can be sent yet; null when it can. */
  notConnected: string | null;
  mostMegabytes: number;
}

export const getEmailInfo = (hotel: string, report: string) =>
  api<EmailInfo>(`/api/hotels/${hotel}/reports/${report}/email`);

export const emailReport = (hotel: string, report: string, body: {
  /** The report's question, as its file route takes it. */
  query: Record<string, string>; fileType: FileType; to: string[]; note: string;
}) => api<{ sent: string[]; failed: { address: string; reason: string }[] }>(
  `/api/hotels/${hotel}/reports/${report}/email`, { method: "POST", body: JSON.stringify(body) });

export type Period = "yesterday" | "last-week" | "last-month" | "month-to-date";
export type Frequency = "daily" | "weekly" | "monthly";

export const PERIOD_WORDS: Record<Period, string> = {
  yesterday: "The day the audit closed",
  "last-week": "Last week, Monday to Sunday",
  "last-month": "Last month",
  "month-to-date": "This month so far",
};

export interface ScheduleInput {
  report: string;
  period: Period;
  frequency: Frequency;
  /** Weekly: 1 Monday to 7 Sunday. */
  weekday: number | null;
  /** Monthly: 1 to 28. */
  dayOfMonth: number | null;
  fileType: FileType;
  addresses: string[];
  isPaused: boolean;
}

export interface Schedule extends ScheduleInput {
  id: string;
  title: string;
  /** "every Sunday", "on the 1st of each month", "every day". */
  when: string;
  changedBy: string | null;
  changedAt: string;
  last: { date: string; status: "sent" | "failed" | "refused"; detail: string | null; at: string } | null;
}

export interface Schedules {
  schedules: Schedule[];
  /** Every report, with the periods it may be scheduled with (none: it cannot be). */
  reports: { key: string; title: string; periods: Period[] }[];
  notConnected: string | null;
}

const base = (hotel: string) => `/api/hotels/${hotel}/report-schedules`;

export const getSchedules = (hotel: string) => api<Schedules>(base(hotel));

export const saveSchedule = (hotel: string, id: string | null, body: ScheduleInput): Promise<unknown> =>
  id
    ? api<{ ok: true }>(`${base(hotel)}/${id}`, { method: "PUT", body: JSON.stringify(body) })
    : api<{ id: string }>(base(hotel), { method: "POST", body: JSON.stringify(body) });

export const removeSchedule = (hotel: string, id: string) =>
  api<{ ok: true }>(`${base(hotel)}/${id}`, { method: "DELETE" });
