import { api, ApiError } from "@/lib/api";
import type { Stay } from "@/data/repositories/types";

/* ══════════════════════════════════════════════════════════════════
   LAUNDRY — the seam

   A price list nobody has priced, a docket that says whose bag it is,
   and what came back out of it. The server is
   `api/src/modules/laundry/laundry.ts`; every shape here is that file's
   answer, not a second opinion about it.

   NULL IS A REAL ANSWER, and it is the whole service. A price nobody
   has set is `null` — it draws "-", never 0, and a docket carrying one
   has NO total rather than a part of one. `0` is allowed and means
   something else entirely: somebody decided it is free. Nothing on
   this path coerces the one into the other.

   WHOSE IT IS IS NOT OPTIONAL (D18-5). `belongsTo` is the first field
   on a docket because it is the first question about one: a guest's
   docket names the stay, and the hotel's own can never be charged —
   refused by the table, not by a screen.

   THE MONEY IS A NUMBER HERE, not a string as purchasing keeps it. Not
   a disagreement: the laundry's server already turns `numeric` into a
   number or null before it answers (`price: r.price === null ? null :
   Number(r.price)`), so a string on this side would be a second
   conversion of the same figure. `null` survives both ways, which is
   the part that matters.
   ══════════════════════════════════════════════════════════════════ */

/** The three things a property does to a garment. The server's own list
    (`SERVICES` in laundry.ts) — it refuses anything else. */
export type LaundryService = "wash" | "press" | "dry_clean";

export const SERVICE_WORDS: Record<LaundryService, string> = {
  wash: "Wash",
  press: "Press",
  dry_clean: "Dry-clean",
};

export interface PriceItem {
  id: string;
  name: string;
  service: LaundryService;
  /** NULL until somebody sets one. A dash on screen, and a docket
      carrying it cannot be charged. 0 is a price and means free. */
  price: number | null;
  isActive: boolean;
}

export type DocketStatus = "open" | "returned" | "cancelled";

export interface Docket {
  id: string;
  number: string;
  /** D18-5. Not a tag on the end of the row — the first thing about it. */
  belongsTo: "guest" | "hotel";
  stayId: string | null;
  stayReference: string | null;
  guestName: string | null;
  roomNumber: string | null;
  status: DocketStatus;
  businessDate: string;
  collectedAt: string | null;
  returnedAt: string | null;
  notes: string | null;
  /** Null when the bag is empty or ANY line in it is unpriced — a
      part-total looks like a total, so there is none. */
  total: number | null;
  pieces: number;
  /** What went out minus what has come back. The hotel's linen question
      and the guest's bag on one mechanism. */
  stillOut: number;
  unpricedLines: number;
  charged: boolean;
}

export interface DocketLine {
  id: string;
  description: string;
  service: LaundryService;
  quantity: number;
  returnedQuantity: number;
  stillOut: number;
  /** Copied from the price list AT COLLECTION, so re-pricing next month
      does not rewrite a docket somebody was handed. Null stays null. */
  unitPrice: number | null;
}

export interface DocketList {
  businessDate: string;
  nextNumber: string;
  dockets: Docket[];
}

export type DocketDetail = Docket & { lines: DocketLine[] };

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/* ⚠ THE READS THROW. They must not end in `catch { return [] }`: a
   screen that could not reach the server would then draw "no dockets
   yet", which is the fault STO-2 and POS-4 were both filed for. The
   module switch being off arrives here as a 403 carrying its own
   sentence, and that sentence is what the screen shows. */

export async function getPriceList(code: string): Promise<{ items: PriceItem[] }> {
  return api<{ items: PriceItem[] }>(`/api/hotels/${code}/laundry/price-list`);
}

export async function getDockets(
  code: string, filter: { whose?: "guest" | "hotel"; status?: DocketStatus } = {},
): Promise<DocketList> {
  const query = new URLSearchParams();
  if (filter.whose) query.set("whose", filter.whose);
  if (filter.status) query.set("status", filter.status);
  const tail = query.toString();
  return api<DocketList>(
    `/api/hotels/${code}/laundry/dockets${tail ? `?${tail}` : ""}`);
}

export async function getDocket(code: string, id: string): Promise<DocketDetail> {
  return api<DocketDetail>(`/api/hotels/${code}/laundry/dockets/${id}`);
}

/** The stays a guest's docket may name. Read over the front desk's own
    HTTP door (`GET /:code/stays`) rather than by importing its data
    layer — one service does not reach into another's insides
    (`src/test/boundaries.test.ts`). A cancelled or checked-out stay is
    refused by the server too; it is left off the list so nobody picks
    one and is told no afterwards. */
export async function getStaysToChargeTo(code: string): Promise<Stay[]> {
  const rows = await api<Stay[]>(`/api/hotels/${code}/stays`);
  return rows
    /* BQ-2: guests in the house only - a booking still to arrive is refused. */
    .filter((s) => s.status === "in-house" || s.status === "due-out")
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

/** Add a line to the price list. `price` left out means NOBODY HAS
    PRICED IT — it is sent as null and reads "-". Never 0. */
export async function addPriceItem(
  code: string, input: { name: string; service: LaundryService; price: number | null; free?: boolean },
): Promise<Result<{ data: { id: string } }>> {
  return call(`/api/hotels/${code}/laundry/price-list`, "POST", input);
}

/** Set a price, or retire a line. Blank takes a price back to "nobody
    has set one", which is a dash and a docket that cannot be charged —
    a different fact from free, which is 0. */
export async function setPriceItem(
  code: string, id: string, input: { price?: number | null; free?: boolean; isActive?: boolean },
): Promise<Result<unknown>> {
  return call(`/api/hotels/${code}/laundry/price-list/${id}`, "POST", input);
}

export interface NewDocket {
  /** Required. There is no default and there is no "guest unless told
      otherwise" — D18-5 is a column on the table, not a tag. */
  belongsTo: "guest" | "hotel";
  stayId?: string;
  notes?: string;
  lines: { priceItemId: string; quantity: number }[];
}

export async function createDocket(
  code: string, input: NewDocket,
): Promise<Result<{ data: { id: string; number: string } }>> {
  return call(`/api/hotels/${code}/laundry/dockets`, "POST", input);
}

/** What came back, as counts. The server works out whether the docket
    is finished — it is never typed. */
export async function returnDocket(
  code: string, id: string, returned: { lineId: string; quantity: number }[],
): Promise<Result<{ data: { stillOut: number } }>> {
  return call(`/api/hotels/${code}/laundry/dockets/${id}/return`, "POST", { returned });
}

export async function cancelDocket(code: string, id: string): Promise<Result<unknown>> {
  return call(`/api/hotels/${code}/laundry/dockets/${id}/cancel`, "POST", {});
}

/** D18-7 — the charge onto the room bill, as its own line. THE SCREEN
    DOES NOT DECIDE ANY OF IT. Whether the bag may be charged at all is
    the server's answer and the database's trigger: the hotel's own
    linen, a cancelled docket, one already on a bill, one with anything
    unpriced in it. This posts the question and shows the sentence that
    comes back. */
export async function chargeDocket(code: string, id: string): Promise<Result<unknown>> {
  return call(`/api/hotels/${code}/laundry/dockets/${id}/charge`, "POST", {});
}

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
