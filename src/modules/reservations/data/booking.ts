import { api, ApiError, apiBase, authHeaders } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   NEW BOOKING'S LISTS AND ITS "BOOKED" CARD (Phase 1, D27-33)

   The owner's two lists (sales people, D27-37; room promotions, D27-36),
   confirming a booking that was waiting for the hotel, the guest's page
   link, and the voucher. Every rule is the server's; this only carries the
   answer, the reason included.
   ══════════════════════════════════════════════════════════════════ */

/** The market segments, the walk-in's five (the owner's choice of 27
    September). Stored as the words themselves. */
export const MARKET_SEGMENTS = ["Corporate", "Leisure", "Group", "Crew", "Government"] as const;

/** The owner's titles (27 September); none leaves it blank. The server and
    migration 146 hold the same four. */
export const TITLES = ["Mr", "Ms", "Mrs", "Dr"] as const;

/** The restaurant's free-hand cap (083's app.pos_freehand_discount_cap),
    shown before the server refuses above it (D27-36). */
export const FREEHAND_CAP = 10;

/** Who may give a complimentary room and keep the two lists (27 Sep). */
export const LIST_KEEPERS = ["owner", "admin", "gm"] as const;

type Answer<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

async function send<T>(path: string, method: string, body: unknown): Promise<Answer<T>> {
  try {
    /* A 2xx IS the yes. Not every door says `ok`: the guest's page link
       (guestDoor.ts) answers { status: 200, link }, and the Booked card
       read the missing `ok` as a refusal - "No link" on every press (BK-2).
       A door that does say ok: false keeps it, as it comes second. */
    return { ok: true, ...(await api<object>(path, { method, body: JSON.stringify(body) })) } as Answer<T>;
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export interface SalesPerson { id: string; name: string }
export interface RoomPromotion { id: string; name: string; percent: number }

export const listSalesPeople = (hotelId: string): Promise<SalesPerson[]> =>
  api<SalesPerson[]>(`/api/hotels/${hotelId}/sales-people`);

/** The whole list, as the dialog shows it. A name left out is switched off. */
export const saveSalesPeople = (hotelId: string, names: string[]) =>
  send(`/api/hotels/${hotelId}/sales-people`, "PUT", { names });

export const listRoomPromotions = (hotelId: string): Promise<RoomPromotion[]> =>
  api<RoomPromotion[]>(`/api/hotels/${hotelId}/room-promotions`);

export const saveRoomPromotions = (
  hotelId: string, promotions: { name: string; percent: number }[],
) => send(`/api/hotels/${hotelId}/room-promotions`, "PUT", { promotions });

/** Waiting for the hotel -> confirmed, for every room booked with it. */
export const confirmWaiting = (hotelId: string, stayId: string) =>
  send<{ rooms: number; reference: string }>(
    `/api/hotels/${hotelId}/stays/${stayId}/confirm`, "POST", {});

/** Waiting for the hotel -> cancelled, every waiting room booked with it,
    with no charge and nothing sent (D27-64). */
export const cancelWaiting = (hotelId: string, stayId: string, reason: string) =>
  send<{ rooms: number; reference: string }>(
    `/api/hotels/${hotelId}/stays/${stayId}/cancel`, "POST", { reason });

/** A CONFIRMED booking's cancellation under the terms it was booked under
    (BK-1): this room only; the charge the terms retain goes on its bill,
    unless the owner, an administrator or the GM waives it. */
export const cancelConfirmed = (hotelId: string, stayId: string, reason: string, waive: boolean) =>
  send<{ rooms: number; reference: string; charged: number | null; waived: boolean }>(
    `/api/hotels/${hotelId}/stays/${stayId}/cancel`, "POST", { reason, ...(waive ? { waive } : {}) });

/** What cancelling would charge, written nowhere. `charge` null: the
    booking carries no terms; 0: inside the free window. */
export const cancelPreview = (hotelId: string, stayId: string) =>
  send<{ preview: { terms: string | null; charge: number | null } }>(
    `/api/hotels/${hotelId}/stays/${stayId}/cancel`, "POST", { dryRun: true });

/** A new link to the guest's own page (114). Only its hash is kept, so each
    press makes a new one; the old ones keep working. */
export const makeGuestLink = (hotelId: string, stayId: string) =>
  send<{ link: string }>(`/api/hotels/${hotelId}/stays/${stayId}/guest-link`, "POST",
    { origin: "desk" });

/** The booking's one voucher, now (D27-35). Refused if it went already. */
export const sendVoucher = (hotelId: string, stayId: string) =>
  send(`/api/hotels/${hotelId}/stays/${stayId}/confirmation`, "POST", {});

/** The booking's voucher PDF (D27-187), opened in a new tab to view, print
    or save. It sends nothing. The tab is opened first, inside the press: one
    opened after an await is a pop-up the browser blocks (root MEMORY 290). */
export async function viewVoucher(
  hotelId: string, stayId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tab = window.open("", "_blank");
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const response = await fetch(
      `${await apiBase()}/api/hotels/${hotelId}/stays/${stayId}/voucher.pdf`, { headers });
    if (!response.ok) {
      tab?.close();
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, reason: body?.error ?? "The voucher could not be opened." };
    }
    const url = URL.createObjectURL(await response.blob());
    if (tab) tab.location.href = url; else window.location.href = url;
    return { ok: true };
  } catch {
    tab?.close();
    return { ok: false, reason: "The voucher needs the connection to open." };
  }
}
