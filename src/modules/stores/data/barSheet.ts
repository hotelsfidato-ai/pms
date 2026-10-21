import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE BAR'S DAILY SHEET (the owner's D27-354) - the screen's calls.
   The server's half: api/src/modules/stores/barSheet.ts.
   ══════════════════════════════════════════════════════════════════ */

export type SheetFormat = "paper" | "simple";

export interface SheetDrink {
  id: string; name: string; unit: string; sizeMl: number | null;
  /** Poured in ml: shown in NIPs and ml. */
  poured: boolean;
  opening: number; received: number; sold: number; other: number; corrected: number; closing: number;
  sell: { nip: number; p30: number; p60: number; p90: number; ml: number };
  counted: number | null; countBook: number | null;
  rate: number | null; amount: number | null;
  onHand: number;
}

export interface BarSheet {
  store: { id: string; name: string; isActive: boolean } | null;
  businessDate: string; date: string; format: SheetFormat;
  mayCount: boolean; maySetFormat: boolean;
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

export const getBarSheet = (hotelId: string, date?: string) =>
  api<BarSheet>(`/api/hotels/${hotelId}/bar/sheet${date ? `?date=${date}` : ""}`);

export const saveBarCount = (hotelId: string, lines: { itemId: string; book: number; counted: number }[]) =>
  send<{ recorded: number; matched: number }>(`/api/hotels/${hotelId}/bar/count`, "POST", { lines });

export const setSheetFormat = (hotelId: string, format: SheetFormat) =>
  send(`/api/hotels/${hotelId}/bar/sheet-format`, "PUT", { format });
