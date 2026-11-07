import { api } from "@/lib/api";

/* Guest feedback (D27-383 item 10): what guests answered on their own page
   after check-out. api/src/modules/reputation/feedback.ts. A part nobody
   scored in a month is null - a dash, never a zero. */

export interface FeedbackMonth {
  month: string;            // YYYY-MM
  answers: number;
  overall: number;
  room: number | null;
  cleanliness: number | null;
  food: number | null;
  staff: number | null;
  /** Answers with a 1 or a 2, overall or in any part. */
  low: number;
}

export interface FeedbackAnswer {
  id: string;
  answeredAt: string;       // the hotel's clock, YYYY-MM-DDTHH:MM
  overall: number;
  room: number | null;
  cleanliness: number | null;
  food: number | null;
  staff: number | null;
  comment: string | null;
  low: boolean;
  stayId: string;
  reference: string;
  guest: string;
  roomNumber: string;
}

export interface FeedbackPage {
  /** Whether the hotel is asking now (Settings, Modules). */
  on: boolean;
  months: FeedbackMonth[];
  answers: FeedbackAnswer[];
  latest: number;
}

export const getFeedback = (code: string) => api<FeedbackPage>(`/api/hotels/${code}/feedback`);
