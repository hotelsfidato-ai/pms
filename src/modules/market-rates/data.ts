import { api } from "@/lib/api";

/* Rivals' prices (D27-270) - the seam. The server decides who may: the
   prices, the people who see prices; the switch, the owner, an
   administrator or the GM. */

export interface Rival { name: string; price: number; source: string | null }
export interface CheckedNight { date: string; checkedAt: string; hotels: Rival[] }

/** Each night's latest check between two dates. A night nobody checked is
    simply absent: the reader shows a dash. */
export const getNearby = (code: string, from: string, to: string) =>
  api<{ nights: CheckedNight[] }>(
    `/api/hotels/${encodeURIComponent(code)}/market-rates?from=${from}&to=${to}`);

export interface RivalsSwitch {
  isOn: boolean;
  /** Whether the server has SERPAPI_KEY. Never the key. */
  keySet: boolean;
  lastRunOn: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export const getRivalsSwitch = (hotel: string) =>
  api<RivalsSwitch>(`/api/hotels/${hotel}/market-rates/switch`);

export const setRivalsSwitch = (hotel: string, isOn: boolean) =>
  api<{ ok: true }>(`/api/hotels/${hotel}/market-rates/switch`, {
    method: "PUT", body: JSON.stringify({ isOn }),
  });

/** The lowest, the middle (the median, to the rupee) and how many. Null
    for a night nobody checked: a dash, never a nought. */
export function nearbySummary(night: CheckedNight | undefined) {
  const prices = (night?.hotels ?? []).map((h) => h.price).sort((a, b) => a - b);
  if (!night || prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  const middle = prices.length % 2 ? prices[mid]! : Math.round((prices[mid - 1]! + prices[mid]!) / 2);
  return { lowest: prices[0]!, middle, count: prices.length, checkedAt: night.checkedAt };
}
