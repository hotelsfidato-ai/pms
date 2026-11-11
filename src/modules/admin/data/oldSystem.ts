import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   BRINGING IN AN OLD SYSTEM'S GUESTS AND BOOKINGS over HTTP (D27-383 item
   7). The server holds every rule (api/src/modules/admin/oldSystem.ts): a
   file is checked there with nothing saved, and saved in one transaction; a
   refusal is its sentence, as a value.
   ══════════════════════════════════════════════════════════════════ */

export type ImportKind = "guests" | "bookings";

export interface ImportField { key: string; label: string; required: boolean; note: string | null }
export interface ImportMatch { id: string; name: string; visits: number }

export interface ImportRow {
  line: number;
  name: string;
  what: string;
  /** new | duplicate | merge | skip | booking | stay | refused */
  action: string;
  problems: string[];
  refused?: string;
  notes: string[];
  matches?: ImportMatch[];
}

export interface ImportCounts {
  rows: number; faults: number; toChoose: number; new: number; merge: number; skip: number;
  bookings: number; stays: number; refused: number; noRate: number;
}

export interface ImportCheck {
  ok: boolean;
  reason?: string;
  headers: string[];
  /** field -> the file's heading, "" for none. */
  columns: Record<string, string>;
  fields: ImportField[];
  rows: ImportRow[];
  counts?: ImportCounts;
  importId?: string;
}

export interface ImportRecord {
  id: string; kind: ImportKind; system: string; fileName: string;
  rowsIn: number; rowsRefused: number; refused: { line: number; reason: string }[];
  /** "Send each guest our booking voucher" was ticked (off by default). */
  sendVouchers: boolean;
  madeAt: string; madeBy: string | null; undoneAt: string | null; undoneBy: string | null;
  guests: number; filled: number; bookings: number; stays: number; advances: number;
}

export interface ImportsView {
  may: boolean;
  reason?: string;
  businessDate?: string;
  /** The hotel's first day here: an advance brought in is from before it. */
  firstDay?: string;
  /** The hotel's booking voucher is switched on (Settings, Messages). */
  voucherOn?: boolean;
  imports?: ImportRecord[];
  /** Bookings brought in with no rate, still to be priced. */
  noRate?: { id: string; reference: string; guest: string; arrival: string; roomType: string }[];
}

export type ImportChoice = { action: "keep" } | { action: "skip" } | { action: "merge"; guestId: string };

type Refused = { ok: false; reason: string };

const said = (error: unknown): Refused & Partial<ImportCheck> => {
  if (error instanceof ApiError) {
    const p = error.body as (Partial<ImportCheck> & { reason?: string }) | undefined;
    return { ...(p ?? {}), ok: false, reason: p?.reason ?? error.message };
  }
  throw error;
};

/** The file's bytes as base64, for the JSON body (as the rooming list's). */
async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export async function getImports(hotelId: string): Promise<ImportsView> {
  try {
    return await api<ImportsView>(`/api/hotels/${hotelId}/imports`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { may: false, reason: (error.body as { reason?: string } | undefined)?.reason ?? error.message };
    }
    throw error;
  }
}

export interface ImportAsk {
  kind: ImportKind; file: File; system: string;
  columns?: Record<string, string>;
  choices?: Record<string, ImportChoice>;
  /** Off unless ticked: the old system confirmed these bookings already. */
  sendVouchers?: boolean;
}

/** Checked, nothing saved (`save` false); or saved, all of it or none. */
export async function sendImport(hotelId: string, ask: ImportAsk, save: boolean): Promise<ImportCheck | (Refused & Partial<ImportCheck>)> {
  try {
    return await api<ImportCheck>(`/api/hotels/${hotelId}/imports/${ask.kind}${save ? "" : "/check"}`, {
      method: "POST",
      body: JSON.stringify({ name: ask.file.name, data: await base64(ask.file), system: ask.system,
                             columns: ask.columns, choices: ask.choices, sendVouchers: ask.sendVouchers === true }),
    });
  } catch (error) { return said(error); }
}

export async function undoImport(hotelId: string, id: string): Promise<{ ok: true } | Refused> {
  try {
    return await api(`/api/hotels/${hotelId}/imports/${id}/undo`, { method: "POST" });
  } catch (error) { return said(error); }
}
