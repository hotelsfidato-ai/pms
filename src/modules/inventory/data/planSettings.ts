import { api } from "@/lib/api";
import { call } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   A RATE PLAN'S SETTINGS, AND MEAL PLANS BY DAY (P3; D27-251, D27-258)

   A plan is a room type on a meal plan; its PRICE is the pricing's own
   (data/pricing.ts) - one price system. Here only: Off for new bookings,
   its place in the tree, the sources that sell it (none chosen = every
   source), and on which days each meal of a plan is served.
   ══════════════════════════════════════════════════════════════════ */

export type Day = "arrival" | "stay" | "departure";
export interface PlanSetting { roomTypeId: string; mealPlan: string; isActive: boolean; position: number; sources: string[] }
export interface MealDays { mealPlan: string; breakfast: Day[]; lunch: Day[]; dinner: Day[] }
export interface Source { id: string; name: string; isActive: boolean }

export const PLAN_SETTINGS_KEY = (hotel: string) => ["plan-settings", hotel] as const;

export const getPlanSettings = (hotel: string) =>
  api<{ plans: PlanSetting[]; mealDays: MealDays[] }>(`/api/hotels/${hotel}/plan-settings`);

export const setPlan = (hotel: string, roomTypeId: string, mealPlan: string,
                        change: { isActive?: boolean; sources?: string[] }) =>
  call(`/api/hotels/${hotel}/plan-settings/${roomTypeId}/${mealPlan}`, "PUT", change);

export const orderPlans = (hotel: string, plans: { roomTypeId: string; mealPlan: string }[]) =>
  call(`/api/hotels/${hotel}/plan-settings/order`, "PUT", { plans });

export const setMealDays = (hotel: string, mealPlan: string, days: Omit<MealDays, "mealPlan">) =>
  call(`/api/hotels/${hotel}/meal-days/${mealPlan}`, "PUT", days);

/** The group's booking sources (guests' own read, GET /booking-sources). */
export const getSources = (hotel: string) => api<Source[]>(`/api/hotels/${hotel}/booking-sources`);

const MEAL_NAMES = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" } as const;
const DAY_WORDS: Record<Day, string> = { arrival: "check-in", stay: "stay-over", departure: "check-out" };

/** "Breakfast on stay-over and check-out days; dinner on check-in and
    stay-over days" - or null when nothing is said (D27-258 Q5). */
export function mealDaysInWords(days: MealDays | undefined): string | null {
  if (!days) return null;
  const parts = (["breakfast", "lunch", "dinner"] as const)
    .filter((m) => days[m].length > 0)
    .map((m, i) => {
      const order = (["arrival", "stay", "departure"] as const).filter((d) => days[m].includes(d));
      const words = order.map((d) => DAY_WORDS[d]);
      const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0];
      const meal = i === 0 ? MEAL_NAMES[m] : MEAL_NAMES[m].toLowerCase();
      return `${meal} on ${list} days`;
    });
  return parts.length ? parts.join("; ") : null;
}
