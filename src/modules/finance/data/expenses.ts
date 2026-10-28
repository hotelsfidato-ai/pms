import { apiBase, authHeaders } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK (the owner's D27-370) - the screens' half

   A paid-out from the desk's drawer or a restaurant's tin has a category and
   may have a photo of its bill. The five words are the database's (245, the
   `*_category_known` checks) and the server's (api finance/expenses.ts);
   the till's Cash step and Cashiering both take them from here.
   ══════════════════════════════════════════════════════════════════ */

export const EXPENSE_CATEGORIES = ["Kitchen", "Housekeeping", "Maintenance", "Office", "Other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** Where a paid-out's photo lives: the desk's drawer or the restaurant's day. */
export const expensePhotoPath = (hotelId: string, place: "desk" | "till", id: string) =>
  `/api/hotels/${hotelId}/${place === "desk" ? "cashier-shift" : "till/day-end"}/movements/${id}/photo`;

/** The photo of the bill, as a form, never held offline. */
export async function attachExpensePhoto(path: string, file: File): Promise<Result> {
  const form = new FormData();
  form.set("file", file);
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}${path}`, { method: "POST", headers, body: form });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string } | null;
    return res.ok && body?.ok ? { ok: true }
      : { ok: false, reason: body?.reason ?? body?.error ?? "The photo was not saved." };
  } catch {
    return { ok: false, reason: "The photo needs the connection. Add it when you are back online." };
  }
}

/** The photo, fetched with the person's own sign-in, as an address only this browser opens. */
export async function expensePhoto(path: string): Promise<Result<{ url: string }>> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}${path}`, { headers });
    if (!res.ok) return { ok: false, reason: "The photo could not be opened." };
    return { ok: true, url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { ok: false, reason: "The photo needs the connection." };
  }
}
