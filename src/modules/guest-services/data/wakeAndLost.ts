import { api, ApiError } from "@/lib/api";

/* Wake-up calls and lost property (D27-239, D27-241). Service: guest-services.
   The server decides who may; a refusal comes back as its sentence. */

export interface WakeUpCall {
  id: string;
  status: "asked" | "set" | "done" | "cancelled";
  fromGuest: boolean;
  room: string | null;
  guest: string | null;
  /** On the hotel's clock: "2026-08-26T07:00". */
  callAt: string;
  note: string | null;
  setBy: string | null;
  handledBy: string | null;
  handledAt: string | null;
  cancelReason: string | null;
  /** Set, and fifteen minutes away or past (D27-241). */
  due: boolean;
}
export interface InHouse { reservationId: string; room: string; guest: string | null }

export interface LostItem {
  id: string; what: string; foundWhere: string; room: string | null; keptWhere: string | null;
  foundOn: string; daysKept: number; foundBy: string | null;
  status: "kept" | "returned" | "disposed";
  returnedTo: string | null; disposeReason: string | null; handledBy: string | null; handledOn: string | null;
}

type Answer = { ok: true } | { ok: false; reason: string };
async function write(path: string, method: string, body: unknown): Promise<Answer> {
  try {
    return await api<Answer>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const listWakeUps = (code: string, view: "open" | "done") =>
  api<{ calls: WakeUpCall[]; rooms: InHouse[]; today: string }>(`/api/hotels/${code}/wake-up-calls?view=${view}`);
export const setWakeUp = (code: string, input: { reservationId: string; day: string; time: string; note?: string }) =>
  write(`/api/hotels/${code}/wake-up-calls`, "POST", input);
export const actOnWakeUp = (code: string, id: string, action: "confirm" | "done" | "cancel", reason?: string) =>
  write(`/api/hotels/${code}/wake-up-calls/${id}`, "PATCH", { action, reason });

export const listLost = (code: string, view: "kept" | "cleared") =>
  api<{ items: LostItem[]; mayClear: boolean }>(`/api/hotels/${code}/lost-property?view=${view}`);
export const logLost = (code: string, input: { what: string; foundWhere: string; roomNumber?: string; keptWhere?: string }) =>
  write(`/api/hotels/${code}/lost-property`, "POST", input);
export const clearLost = (code: string, id: string, action: "returned" | "disposed", words: string) =>
  write(`/api/hotels/${code}/lost-property/${id}`, "PATCH",
    action === "returned" ? { action, to: words } : { action, reason: words });
