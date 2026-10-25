import { api, ApiError, downloadFile } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE BAR'S DAILY SHEET (the owner's D27-354; two places, D27-361) -
   the screen's calls. The server's half: api/src/modules/stores/
   barSheet.ts (the sheet, the counts, the drinks, "Bar closed today") and
   barRequests.ts (the counter asks the store).
   ══════════════════════════════════════════════════════════════════ */

export type SheetFormat = "paper" | "simple";
export type Place = "counter" | "store";
export type Moment = "closing" | "morning";
export type CountAs = "poured" | "whole" | "packet";

export interface SheetDrink {
  id: string; name: string; unit: string; sizeMl: number | null;
  countAs: CountAs; packSize: number | null;
  /** Poured in ml: shown in NIPs and ml. */
  poured: boolean;
  /** received: bills into the store, or the store's stock into the counter; moved: the store's to the counter. */
  opening: number; received: number; moved: number; sold: number; other: number; corrected: number; closing: number;
  sell: { nip: number; p30: number; p60: number; p90: number; ml: number };
  counted: number | null; countBook: number | null;
  morning: number | null; morningBook: number | null;
  rate: number | null; amount: number | null;
  onHand: number;
}

export interface BarSheet {
  place: Place;
  places: { counter: { id: string; name: string } | null; store: { id: string; name: string } | null };
  store: { id: string; name: string; isActive: boolean } | null;
  businessDate: string; date: string; format: SheetFormat;
  mayCount: boolean; maySetFormat: boolean; mayApprove: boolean; mayCloseBar: boolean;
  closedToday: { reason: string; by: string | null } | null;
  pendingRequests: number;
  groups: { section: string; drinks: SheetDrink[] }[];
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

async function send<T>(path: string, method: string, body: unknown): Promise<Result<T>> {
  try {
    return await api<Result<T>>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const getBarSheet = (hotelId: string, date?: string, place: Place = "counter") =>
  api<BarSheet>(`/api/hotels/${hotelId}/bar/sheet?place=${place}${date ? `&date=${date}` : ""}`);

export const saveBarCount = (
  hotelId: string, place: Place, moment: Moment, lines: { itemId: string; book: number; counted: number }[],
) => send<{ recorded: number; matched: number }>(`/api/hotels/${hotelId}/bar/count`, "POST", { place, moment, lines });

export const setSheetFormat = (hotelId: string, format: SheetFormat) =>
  send(`/api/hotels/${hotelId}/bar/sheet-format`, "PUT", { format });

/* ── The bar's drinks, on Set up ──────────────────────────────────── */
export const LIQUORS: { value: string; label: string }[] = [
  { value: "whisky", label: "Whisky" }, { value: "rum", label: "Rum" }, { value: "vodka", label: "Vodka" },
  { value: "gin", label: "Gin" }, { value: "brandy", label: "Brandy" }, { value: "tequila", label: "Tequila" },
  { value: "liqueur", label: "Liqueur" }, { value: "wine", label: "Wine" },
  { value: "beer_strong", label: "Beer, strong (fermented)" }, { value: "beer_mild", label: "Beer, mild" },
  { value: "other", label: "Other liquor" },
];

export interface DrinkInput {
  name: string; sizeMl: number | null; countAs: CountAs; packSize: number | null;
  brand: string | null; liquor: string | null; imported: boolean;
}
export const addBarDrink = (hotelId: string, d: DrinkInput) =>
  send<{ id: string }>(`/api/hotels/${hotelId}/bar/drinks`, "POST", d);
export const editBarDrink = (hotelId: string, id: string, d: DrinkInput) =>
  send(`/api/hotels/${hotelId}/bar/drinks/${id}`, "PUT", d);

/* ── "Bar closed today" ───────────────────────────────────────────── */
export const markBarClosed = (hotelId: string, reason: string) =>
  send(`/api/hotels/${hotelId}/bar/closed`, "POST", { reason });
export const undoBarClosed = (hotelId: string) => send(`/api/hotels/${hotelId}/bar/closed/undo`, "POST", {});

/* ── The counter asks the store ───────────────────────────────────── */
export interface BarRequest {
  id: string; status: "pending" | "approved" | "rejected"; note: string | null; decisionNote: string | null;
  requestedBy: string | null; mine: boolean; requestedAt: string; decidedBy: string | null; decidedAt: string | null;
  lines: { itemId: string; name: string; quantity: number; countAs: CountAs | null; inStore: number | null }[];
}
export const getBarRequests = (hotelId: string) =>
  api<{ mayAsk: boolean; mayApprove: boolean; requests: BarRequest[] }>(`/api/hotels/${hotelId}/bar/requests`);
export const askTheStore = (hotelId: string, lines: { itemId: string; quantity: number }[], note: string) =>
  send<{ id: string }>(`/api/hotels/${hotelId}/bar/requests`, "POST", { lines, note });
export const approveRequest = (hotelId: string, id: string) =>
  send<{ moved: number }>(`/api/hotels/${hotelId}/bar/requests/${id}/approve`, "POST", {});
export const rejectRequest = (hotelId: string, id: string, note: string) =>
  send(`/api/hotels/${hotelId}/bar/requests/${id}/reject`, "POST", { note });

/* ── The excise registers, as PDFs (D27-361) ──────────────────────── */
export const downloadRegister = (hotelId: string, which: "flr-daily" | "flr-monthly", date: string) =>
  downloadFile(`/api/hotels/${hotelId}/reports/${which}.pdf?asOn=${date}${which === "flr-monthly" ? `&month=${date.slice(0, 7)}` : ""}`);
