import { api } from "@/lib/api";
import { at, withUnlock } from "@/modules/online-checkin/data/guestPage";
import type { Preferences } from "@/modules/guests";

/* The guest's own preferences and the feedback survey (D27-383 item 10),
   behind the code: api/src/routes/guestPreferences.ts and guestSurvey.ts. */

export const getMyPreferences = (token: string) =>
  api<{ preferences: Preferences; smokingOffered: boolean }>(at(token, "/preferences"), withUnlock(token));
export const saveMyPreferences = (token: string, preferences: Preferences) =>
  api<{ saved: true }>(at(token, "/preferences"),
    withUnlock(token, { method: "PUT", body: JSON.stringify({ preferences }) }));

export interface SurveyAnswer {
  overall: number; room: number | null; cleanliness: number | null;
  food: number | null; staff: number | null; comment: string;
}
export const getSurvey = (token: string) =>
  api<{ offered: boolean; answered: boolean }>(at(token, "/survey"), withUnlock(token));
export const answerSurvey = (token: string, answer: SurveyAnswer) =>
  api<{ sent: true }>(at(token, "/survey"), withUnlock(token, { method: "POST", body: JSON.stringify(answer) }));
