import { api, ApiError, apiBase, authHeaders } from "@/lib/api";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   BAR BILLS (the owner's D27-354) - the screen's calls

   A bar bill that has come, recorded as it is: supplier, number, date, its
   drinks (bottles, cost per bottle as paid), and a photo of it. The drinks go
   into the bar's store at once. The server's half:
   api/src/modules/purchasing/barBills.ts.
   ══════════════════════════════════════════════════════════════════ */

/** Who records one: a COPY of the server's BAR_RECORDERS (purchasingGrants.ts). */
export const BAR_RECORDERS: readonly Role[] = ["owner", "admin", "gm", "stores"];

export interface BarDrink {
  id: string; name: string; unit: string;
  /** A bottle's size in ml; null for what is not poured. */
  sizeMl: number | null;
  /** What the bar's store holds now, in the unit; null with no bar store. */
  onHand: number | null;
}

export interface BarBillLine {
  item: string; unit: string; sizeMl: number | null; quantity: number; unitCost: number | null;
}

export interface BarBill {
  id: string; supplier: string; billNo: string; billDate: string;
  recordedBy: string | null; recordedAt: string; photoId: string | null;
  lines: BarBillLine[];
}

export type NewBillLine =
  | { itemId: string; bottles: number; costPerBottle: number }
  | { newDrink: { name: string; unit: string; sizeMl: number | null }; bottles: number; costPerBottle: number };

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export const barDrinks = (hotelId: string) =>
  api<{ store: { id: string; name: string; isActive: boolean } | null; drinks: BarDrink[] }>(
    `/api/hotels/${hotelId}/bar/drinks`);

export const barBills = async (hotelId: string) =>
  (await api<{ purchases: BarBill[] }>(`/api/hotels/${hotelId}/bar/purchases`)).purchases;

export async function recordBarBill(hotelId: string, bill: {
  supplier: string; billNo: string; billDate: string; lines: NewBillLine[];
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

/** The bill's photo, through the shared attachments route (as a deposit
    slip's: a form, never JSON, and never held offline). */
export async function attachBarBillPhoto(hotelId: string, billId: string, file: File): Promise<Result> {
  const form = new FormData();
  form.set("table", "bar_purchases");
  form.set("id", billId);
  form.set("file", file);
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}/api/hotels/${hotelId}/attachments`,
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
export async function barBillPhoto(hotelId: string, attachmentId: string): Promise<Result<{ url: string }>> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}/api/hotels/${hotelId}/attachments/${attachmentId}/file`, { headers });
    if (!res.ok) return { ok: false, reason: "The photo could not be opened." };
    return { ok: true, url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { ok: false, reason: "The photo needs the connection." };
  }
}

