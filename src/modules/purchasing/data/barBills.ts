import { api, ApiError, apiBase, authHeaders } from "@/lib/api";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   BAR BILLS (the owner's D27-354) - the screen's calls

   A bar bill that has come, recorded as printed: supplier, number, date, T.P.
   number; each drink's MRP, cases and loose bottles, bottles to a case and
   rate per case; handling, TCS and the printed total; and a photo of it. The
   drinks go into the bar's store at once. The server's half:
   api/src/modules/purchasing/barBills.ts.
   ══════════════════════════════════════════════════════════════════ */

/** Who records one: a COPY of the server's BAR_RECORDERS (purchasingGrants.ts). */
export const BAR_RECORDERS: readonly Role[] = ["owner", "admin", "gm", "stores", "bar"];

export interface BarDrink {
  id: string; name: string; unit: string;
  /** A bottle's size in ml; null for what is not poured. */
  sizeMl: number | null;
  /** What the bar's store holds now, in the unit; null with no bar store. */
  onHand: number | null;
  /** Bottles to a case, from its last bill; null before one. */
  perCase: number | null;
}

export interface BarBillLine {
  item: string; unit: string; sizeMl: number | null; mrp: number | null;
  perCase: number; cases: number; bottles: number; ratePerCase: number; amount: number;
}

export interface BarBill {
  id: string; supplier: string; billNo: string; billDate: string; tpNo: string | null;
  handling: number | null; tcs: number | null; total: number | null;
  recordedBy: string | null; recordedAt: string; photoId: string | null;
  /** On credit (D27-370): when it is due, and when it was paid; null when paid on the day. */
  credit: { dueOn: string; paidOn: string | null } | null;
  lines: BarBillLine[];
}

type LineFigures = { mrp: number | null; perCase: number; cases: number; bottles: number; ratePerCase: number };
export type NewBillLine =
  | ({ itemId: string } & LineFigures)
  | ({ newDrink: { name: string; unit: string; sizeMl: number | null } } & LineFigures);

/** A line's amount as the bill works it - the server's lineAmount, copied. */
export const lineAmount = (l: { perCase: number; cases: number; bottles: number; ratePerCase: number }) =>
  Math.round(l.ratePerCase * (l.cases + l.bottles / l.perCase) * 100) / 100;

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export const barDrinks = (hotelId: string) =>
  api<{ store: { id: string; name: string; isActive: boolean } | null; drinks: BarDrink[] }>(
    `/api/hotels/${hotelId}/bar/drinks`);

export const barBills = async (hotelId: string) =>
  (await api<{ purchases: BarBill[] }>(`/api/hotels/${hotelId}/bar/purchases`)).purchases;

export async function recordBarBill(hotelId: string, bill: {
  supplier: string; billNo: string; billDate: string; tpNo: string | null;
  handling: number | null; tcs: number | null; total: number; lines: NewBillLine[];
  /** On credit: its due date (D27-370). */
  dueOn?: string;
}): Promise<Result<{ id: string }>> {
  try {
    return await api<Result<{ id: string }>>(`/api/hotels/${hotelId}/bar/purchases`,
      { method: "POST", body: JSON.stringify(bill) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** The bill's photo, through the bar bill's own door (the Bar role holds no
    grant on the shared attachments): a form, never JSON, never held offline. */
export async function attachBarBillPhoto(hotelId: string, billId: string, file: File): Promise<Result> {
  const form = new FormData();
  form.set("file", file);
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}/api/hotels/${hotelId}/bar/purchases/${billId}/photo`,
      { method: "POST", headers, body: form });
    const body = (await res.json().catch(() => null)) as
      { ok?: boolean; reason?: string; error?: string } | null;
    return res.ok && body?.ok ? { ok: true }
      : { ok: false, reason: body?.reason ?? body?.error ?? "The photo was not saved." };
  } catch {
    return { ok: false, reason: "The photo needs the connection. Add it when you are back online." };
  }
}

/** The photo, fetched with the person's own sign-in, as an address only this browser opens. */
export async function barBillPhoto(hotelId: string, billId: string): Promise<Result<{ url: string }>> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}/api/hotels/${hotelId}/bar/purchases/${billId}/photo`, { headers });
    if (!res.ok) return { ok: false, reason: "The photo could not be opened." };
    return { ok: true, url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { ok: false, reason: "The photo needs the connection." };
  }
}

