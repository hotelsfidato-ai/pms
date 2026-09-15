import { fetchOr } from "./http";
/* What an outside till sent.

   Service: pos. Moved out of billing.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ══════════════════════════════════════════════════════════════════
   POS — the PMS side

   The bridge an outlet posts across was built at Stage 7 and had no
   interface: settling "the restaurant says they charged it, the folio
   says otherwise" meant SQL. These are what the POS screen reads.

   Note what is NOT here: no menu, no orders, no tables. Those belong
   to the POS, which is a separate system. This is the PMS looking at
   what arrived.
   ══════════════════════════════════════════════════════════════════ */

export interface PosOutlet {
  code: string;
  name: string;
  category: string;
  /** An outlet with no key cannot post. Said plainly on the screen. */
  hasKey: boolean;
  isActive: boolean;
  bills: number;
}

export async function listPosOutlets(hotelId: string): Promise<PosOutlet[]> {
  if (!hotelId) return [];
  return fetchOr<PosOutlet[]>(`/api/hotels/${hotelId}/pos/outlets`, []);
}

export interface PosTicket {
  id: string;
  outlet: string;
  outletName: string;
  /** The POS's own bill number — what a waiter reads off their terminal. */
  ticketRef: string;
  status: "posted" | "voided" | "rejected";
  /** Why a bill was refused. Null on one that landed. */
  reason: string | null;
  amount: number;
  tax: number;
  businessDate: string;
  receivedAt: string;
  /** Null on a refused bill: it never reached a folio. */
  guest: string | null;
  room: string | null;
  postingId: string | null;
  voidPostingId: string | null;
  items: unknown;
}

export interface PosTickets {
  from: string;
  to: string;
  rows: PosTicket[];
}

export async function listPosTickets(
  hotelId: string, from?: string, to?: string,
): Promise<PosTickets | null> {
  if (!hotelId) return null;
  const q = from && to ? `?from=${from}&to=${to}` : "";
  return fetchOr<PosTickets | null>(
    `/api/hotels/${hotelId}/pos/tickets${q}`, null,
  );
}
