import { api, ApiError, HeldError } from "@/lib/api";
import type { ImportReport } from "@/data/repositories/importReport";

/* ══════════════════════════════════════════════════════════════════
   THE TILL — the POS built into the PMS

   The POS screen built at Stage 7 reads the BRIDGE: what an outside
   till sent and what became of it. This is the other half, and it
   WRITES — a waiter opens an order, adds to it, settles it.

   Every refusal here comes back as `{ ok: false, reason }` rather than
   an exception, because every one of them is something a person at a
   terminal has to act on: the room has two guests, the dish is off,
   the bill is already paid. Rule 6 — say what was refused and why.
   ══════════════════════════════════════════════════════════════════ */

export interface MenuItem {
  id: string;
  name: string;
  /** The item's own price. **Meaningless once it has variations** — the
      variation carries the price, and the database refuses a line that
      names none. */
  price: number;
  /** What a bill given free (NC) values this dish at in the stock reports
      (D27-351, D27-373), typed by the GM. Null - or absent on a menu cached
      before it - is none typed: a dash, never 0 and never the price. */
  mrp?: number | null;
  /** Per ITEM, not per outlet: 5% on food, 18% on packaged water. The
      rate the till RINGS it at - its own, else its section's - as the
      server resolves it. Null is "none set": a dash, never 0% (POS-15). */
  taxRate: number | null;
  isActive: boolean;

  /** What a fast biller types. Null for most items. */
  shortCode: string | null;
  /** THREE states. `null` means nobody has said, and it must not render
      as the green mark — an unmarked dish is not a vegetarian one. */
  isVeg: boolean | null;
  isFavourite: boolean;
  /** "We are out of paneer", until this moment. A timestamp rather than
      a flag somebody must remember to unset. */
  offUntil: string | null;
  offReason: string | null;

  /** HOW LONG IT TAKES, resolved: this dish's own time, else its
      category's, else null.

      ⚠ NULL MEANS UNTIMED, NEVER INSTANT. It renders as a dash, the
      same rule the prices follow — "0 minutes" would sort a dish to the
      front of a kitchen display and get it started last. */
  prepMinutes: number | null;
  /** Set on the dish itself. Lets a screen tell "12 minutes, chosen for
      this dish" from "12 minutes, inherited from Main course". */
  ownPrepMinutes: number | null;

  /** Which course, resolved. NULL is an unsequenced dish — a drink —
      which is not course zero and sorts after the sequence. */
  course: number | null;
  ownCourse: number | null;

  /** Oil ₹300, Butter ₹400. Empty for most of a menu. */
  variations: MenuVariation[];
  addonGroups: AddonGroup[];
}

export interface MenuVariation {
  id: string;
  label: string;
  /** Type 1: the dish's price. A later type: what it adds (D27-192). */
  price: number;
  /** Type 1 only: its MRP, as the dish's (D27-373). Null is a dash. */
  mrp?: number | null;
  /* Its type. Absent on a menu cached before 30 September: read as type 1
     with no kind, which is what every choice was then. */
  typeNo?: number;
  kind?: VariationKind | null;
  heading?: string | null;
}

export type VariationKind = "size" | "quantity" | "option";

export interface AddonGroup {
  id: string;
  label: string;
  /** `minSelect` above zero makes the group a required choice. */
  minSelect: number;
  maxSelect: number | null;
  addons: Addon[];
}

export interface Addon {
  id: string;
  label: string;
  price: number;
  offUntil: string | null;
}

/** What a menu section sells under. "alcohol" is VAT (D21-91), and only
    where the property serves it (D21-90). */
export type SectionHeading = "restaurant" | "bar" | "banquet" | "alcohol" | "other";

/** The Bar side of the menu (D27-267): sections sold under Bar or Alcohol.
    They get the bar notes and the order screen's Bar tab. */
export const isBarSection = (c: { taxKind?: SectionHeading | null }) =>
  c.taxKind === "bar" || c.taxKind === "alcohol";

/** Whether this dish sits in a Bar section of this menu. */
export const isBarDish = (menu: MenuCategory[] | undefined, itemId: string | undefined) =>
  !!itemId && (menu ?? []).some((c) => isBarSection(c) && c.items.some((i) => i.id === itemId));

export interface MenuCategory {
  id: string;
  name: string;
  /** Its tax heading (D22-4). Null is not set. Absent in a menu cached
      before 23 September, which reads the same. */
  taxKind?: SectionHeading | null;
  /** The preparation time every dish in here inherits unless it sets
      its own. Null means nobody has said. */
  prepMinutes: number | null;
  /** The course everything in here belongs to, unless a dish says
      otherwise. Null takes the whole category out of the sequence. */
  course: number | null;
  items: MenuItem[];
}

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  /** Copied onto the line when it was added, so a price rise next
      month does not re-price a bill printed today. */
  unitPrice: number;
  taxRate: number;
  /** "vat" for alcohol (D21-91): its tax prints as one VAT line, never as a
      CGST and SGST pair. The server always sends it; absent reads as GST. */
  taxScheme?: "gst" | "vat";
  note: string | null;
  /** Struck, not removed. A manager settling a dispute wants to see
      that a dish was added and cancelled four times. */
  voided: boolean;
  /** pending · sent · preparing · ready · served.
   *
   *  `pending` until a waiter sends the ticket. The till shows it so a
   *  second KOT does not re-fire the starters while they are being
   *  eaten. */
  kotStatus: string;
  /** The KOT it went on and that KOT's kind (D27-324 (4): the order screen
      reprints them). Null until it is sent; the kind is null on a line sent
      before KOT kinds, whose KOT prints whole. Absent on an order read
      before 14 October. */
  kotNo?: number | null;
  kotKind?: { id: string; name: string } | null;
  /** A parcel's packing charge (D27-359): on the bill, never a dish. */
  packing?: boolean;
  /** Null when the reader may not see that person (staff is row-secured). */
  addedBy: string | null;

  /** Set on an ADD-ON line, naming the dish it belongs to. The bill and
      the kitchen docket both indent on it, exactly as the printed
      ticket does. */
  parentLineId: string | null;
  isAddon: boolean;
  /** The dish and its choices (D27-349): the waiter's pad puts one more of a
      sent dish on its round with them. Absent on an answer from before. */
  itemId?: string | null;
  addonId?: string | null;
  moreChoiceIds?: string[];
  variationId: string | null;
  /** The numbered Add-ons folded into this dish (D27-289), as chosen: the
      bill prints "Veg Biryani 310 · Kebab +120" under the line, and
      Customise opens on them. Null or absent when it has none. */
  numberedAddons?: LineAddons | null;
  /** An add-on as a line of its own under parentLineId (D27-291): custom
      (typed by staff) or numbered (put on a dish already sent). Its own
      quantity; the bill reads "+ Extra papad". Null or absent otherwise. */
  extra?: "custom" | "numbered" | null;
}

/** A custom add-on as Customise and the pad hold it (D27-291): typed by
    staff, its own quantity. A price of 0 is one somebody ticked Free -
    there is no default. */
export interface CustomAddon { name: string; price: number; qty: number }

/** What a screen sends for one add-on line (D27-291): one of the numbered
    list, or a typed one. */
export interface ExtraInput {
  numberedId?: string;
  name?: string;
  price?: number;
  free?: boolean;
  qty: number;
}

/** Typed add-ons as the server takes them: a 0 goes as Free, never as a price. */
export const customInputs = (customs: readonly CustomAddon[]): ExtraInput[] =>
  customs.map((c) => (c.price === 0
    ? { name: c.name, free: true, qty: c.qty }
    : { name: c.name, price: c.price, qty: c.qty }));

/** One numbered Add-on (D27-289): "2 · Kebab · ₹120". The number is what
    staff remember; it never changes. */
export interface NumberedAddon {
  id: string;
  number: number;
  name: string;
  /** A line on what it is - "two pieces of seekh kebab". */
  description: string | null;
  price: number;
  /** A 0 that somebody chose (D27-120); a blank is never a 0. */
  free: boolean;
  isActive: boolean;
  offUntil: string | null;
  offReason: string | null;
}

/** One add-on as a dish's line keeps it - copied when chosen. */
export interface LineAddon {
  id: string; number: number; name: string; price: number;
  /** How many on ONE of the dish: "Kebab ×2". */
  qty: number;
}

/** What a dish's line keeps of its numbered add-ons (208). */
export interface LineAddons {
  /** The dish as named before them: "Veg Biryani". */
  dish: string;
  /** One of it before them, in rupees. */
  base: number;
  addons: LineAddon[];
}

/** What a screen sends: which add-on, how many on one of the dish. */
export interface NumberedChoice { id: string; qty: number }

export interface KitchenLine {
  id: string;
  orderNo: string;
  table: string | null;
  orderType: string;
  outlet: string;
  name: string;
  qty: number;
  note: string | null;
  status: string;
  /** Since it reached the kitchen. The pass sorts and colours by this. */
  waitedSeconds: number;
  /** What it should take, from the dish or its category. NULL means
      nobody has timed it — a dash, never a zero. */
  prepMinutes: number | null;
  /** Which course this dish belongs to. NULL is an unsequenced dish —
      a drink — which is not course zero and must not sort ahead of the
      starters. */
  course: number | null;
  /** Struck after the kitchen already had it — stop cooking. */
  cancelled: boolean;
  /** The dish's numbered add-ons, read under it: "+ Kebab" (D27-289). */
  plus?: { name: string; qty: number }[];
  /** On an add-on line of its own (D27-291): the dish it goes with. */
  forDish?: string | null;
  /** The KOT kind it printed on (D27-292): the board's filter. */
  kindId?: string | null;
  /** Why, in the manager's words (D27-119). */
  cancelReason?: string | null;
}

export interface Order {
  id: string;
  orderNo: string;
  outlet: string;
  outletName: string;
  /** Copied onto the order, so a reprint next year is not re-dressed
      in whatever the property list says by then. */
  hotelName: string;
  hotelCity: string | null;
  hotelGstin: string | null;
  /** The hotel's FSSAI licence number (A16), null until typed. */
  hotelFssai?: string | null;
  /** The HSN/SAC codes of the kinds its lines sell under (D27-344), null until set. */
  hotelSac?: string | null;
  table: string | null;
  /** `void`: a PAID bill voided by the owner, an administrator or the GM
      (D27-324). It keeps its number and reprints VOID. `no_charge`: an
      open bill given free, NC, by the same three (D27-351). */
  status: "open" | "settled" | "abandoned" | "void" | "no_charge" | "joined";
  businessDate: string;
  paymentMethod: string | null;
  /** The room a bill charged to a room went to; null otherwise. Optional:
      an answer from before D27-324 has no such key. */
  room?: string | null;
  /** Who voided it, when (HH:MM), why, and the refund's reference for a
      card or UPI bill (D27-324). Null on a bill that is not void. */
  voidedBy?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  voidReference?: string | null;
  /** A bill given free, NC (D27-351): who gave it - their name is the
      approval - when (HH:MM) and why. Null on any other bill. */
  ncBy?: string | null;
  ncAt?: string | null;
  ncReason?: string | null;
  /** What was sent to the GM about this bill, and the answer (D27-363). */
  requests?: PosRequest[];
  /** Its payment mode changed before the night audit (D27-363). */
  modeChanges?: { from: string; to: string; amount: number; reason: string; by: string | null; at: string }[];
  /** Its table moves and joins (D27-370): from which table to which, who, when (HH:MM). */
  moves?: { from: string; to: string; joined: boolean; by: string | null; at: string }[];
  /** Null when the reader may not see that person: a GM reading an order
      the group owner opened (D27-1). Printed as a dash. */
  openedBy: string | null;
  settledBy: string | null;
  settledAt: string | null;
  abandonedReason: string | null;
  ticketId: string | null;
  /** The banquet function this order is on (D17-21), and its name. An
      order on a function is paid on the function's bill: it settles "to
      the function" and no other way (the owner, 17 September). */
  eventId: string | null;
  eventTitle: string | null;
  /** The VAT bill issued for the alcohol when it was paid here (D22-44).
      Optional: an answer from before it existed has no such key. */
  vatBill?: string | null;
  /** Bills printed after payment (D27-292): the next one is BILL · DUPLICATE. */
  billsPrinted?: number;
  lines: OrderLine[];

  net: number;
  /** As APPLIED, which is what the arithmetic used. */
  discount: number;
  /** What the biller ENTERED, and what the bill prints. "10% off" reads
      differently from "₹115.70 off" even when the money is identical, and
      recomputing the rate from the amount fails once a line moves. */
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
  discountReason: string | null;
  /* ⚠ WHICH PROMOTION, not only that a discount happened. NULL is a
     free-hand discount inside the cap — a different act from a policy
     decided in advance, and month end has to be able to tell them
     apart. A report that cannot is reporting on neither. */
  promotionId: string | null;
  promotionName: string | null;
  taxable: number;
  tax: number;
  /** The bill's tax lines (D27-334): the database's split by scheme and
      rate, on the discounted value. Zero lines are left out. */
  taxes: Array<{ scheme: "gst" | "vat"; rate: number; tax: number }>;
  gross: number;
  /** Signed, and under a rupee. Its own line on the bill. */
  roundOff: number;
  /** gross + roundOff. What the guest actually hands over. */
  payable: number;
  tenders: Tender[];

  /* ── The header ──────────────────────────────────────────────────
     `covers` is people EATING, not seats. Average per cover is the
     metric a restaurant runs on, and a table for two that seats six
     says nothing. Null means nobody recorded it — which is excluded
     from the average, not counted as one. */
  covers: number | null;
  /** Who took the order. Not `openedBy`, which on a shared terminal is
      one person for the whole evening. */
  waiter: string | null;
  orderType: "dine_in" | "takeaway" | "room_service" | "delivery";
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerLocality: string | null;
  /** Parked. A table on drinks and not ready for food should not be a
      bill a waiter has to remember. */
  heldAt: string | null;
}

/** One payment against a bill. Several when the guest paid two ways. */
export interface Tender {
  id: string;
  /** "allowance": the owner's allowance paid this part, free (D27-366). */
  method: "room" | "cash" | "card" | "upi" | "allowance";
  amount: number;
  /** Cash handed over. Null for every other method. */
  tendered: number | null;
  /** Derived from `tendered`, never stored — a stored figure is one more
      thing that can disagree with the arithmetic. */
  change: number | null;
  reference: string | null;
  takenBy: string | null;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  outlet: string;
  table: string | null;
  status: string;
  businessDate: string;
  gross: number;
  /** The menu prices before discount and tax: an NC bill's value (D27-394). */
  net: number;
  paymentMethod: string | null;
  openedAt: string;
  lines: number;
}

export interface ChargeableRoom {
  room: string;
  guest: string;
  folioId: string;
  /** The company, when this is a split stay's company bill (D27-162). */
  company?: string | null;
}

/** A refusal a person can act on, or the order as it now stands. */
export type TillResult =
  | { ok: true; order: Order; guest?: string; room?: string }
  | { ok: false; reason: string; choices?: { folioId: string; guest: string; company?: string | null }[] };

/* ── Reads ────────────────────────────────────────────────────────────

   ⚠ A READ THAT FAILS, THROWS. Every read below used to end in
   `catch { return [] }`, so a server fault reached the screen as an
   empty list — "This property has no restaurant configured" on a day
   end that had merely failed to load (POS-4). The error now reaches
   React Query, which keeps the last good answer when a refresh fails,
   and the screen says which it was: refused, failed, or truly empty
   (`components/ReadProblem.tsx`).

   A missing hotel or order id still answers empty without asking —
   there is no request to fail. */

/** Whether this person may use the POS at this property — both the
    module and the reception switch (087).

    ⚠ ONLY AN EXPLICIT REFUSAL BLOCKS. The till works offline through the
    outbox, so a request that never arrived answers "go ahead" and lets
    the screen's own offline handling take over. A 403 is the server
    saying no, with the sentence the screen then shows — the reads used
    to turn every failure into an empty list, which is how a refused
    receptionist was told "There is no menu yet" (14 September). */
export async function getPosAccess(
  hotelId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hotelId) return { ok: true };
  try {
    await api<{ ok: true }>(`/api/hotels/${hotelId}/till/access`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    return { ok: true };
  }
}

export async function getMenu(hotelId: string): Promise<MenuCategory[]> {
  if (!hotelId) return [];
  const body = await api<{ categories: MenuCategory[] }>(
    `/api/hotels/${hotelId}/till/menu`,
  );
  return body.categories;
}

export async function listOrders(
  hotelId: string,
): Promise<{ businessDate: string; orders: OrderSummary[] } | null> {
  if (!hotelId) return null;
  return api<{ businessDate: string; orders: OrderSummary[] }>(
    `/api/hotels/${hotelId}/till/orders`,
  );
}

/** An earlier day's finished bills (20 Oct): one business date, or those
    whose number holds what was typed, on any day; newest first, at most 100. */
export async function listEarlierBills(
  hotelId: string, ask: { date?: string; no?: string },
): Promise<OrderSummary[]> {
  const q = new URLSearchParams();
  if (ask.date) q.set("date", ask.date);
  if (ask.no?.trim()) q.set("no", ask.no.trim());
  return (await api<{ bills: OrderSummary[] }>(`/api/hotels/${hotelId}/till/bills?${q}`)).bills;
}

/** One line of Bill history (D27-370): the earlier-bill row, with who and how it was paid. */
export interface BillHistoryRow extends OrderSummary {
  /** What the guest paid: the bill's GRAND TOTAL. */
  payable: number;
  /** Every way it was paid, as the till took it: cash, card, upi, room, function, allowance. */
  modes: string[];
  waiter: string | null;
  guest: string | null;
  phone: string | null;
  /** When it was paid, or given NC, on the hotel's clock (D27-372). */
  settledAt: string | null;
  /** A bill charged to a room: the stay's guest and room (D27-372). */
  stayGuest: string | null;
  room: string | null;
}
export interface BillHistoryAsk {
  from?: string; to?: string; no?: string; table?: string; guest?: string;
  mode?: string; waiter?: string; outlet?: string;
}
export interface BillHistory {
  bills: BillHistoryRow[];
  /** True when more matched than the server sends: `cap` is what it sent. */
  capped: boolean;
  cap: number;
  outlets: { code: string; name: string }[];
}

/** Bill history (D27-370): the same route as the Till's earlier bill, over a range of dates and narrowed by what was typed. */
export function listBillHistory(hotelId: string, ask: BillHistoryAsk): Promise<BillHistory> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(ask)) if (v?.trim()) q.set(k, v.trim());
  return api<BillHistory>(`/api/hotels/${hotelId}/till/bills?${q}`);
}

export async function getOrder(
  hotelId: string, orderId: string,
): Promise<Order | null> {
  if (!hotelId || !orderId) return null;
  return api<Order>(`/api/hotels/${hotelId}/till/orders/${orderId}`);
}

/** ⚠ KEPT ON THE DEVICE so a room can be charged with the line down
    (`till-rooms` in App.tsx's PERSISTED, the owner's decision of
    8 September). When this caught its own failure, the refetch that
    runs each time the settle panel opens answered an empty list with
    no connection — and that empty list replaced the one kept on the
    device. Throwing leaves the kept list where it is. */
export async function listChargeableRooms(
  hotelId: string,
): Promise<ChargeableRoom[]> {
  if (!hotelId) return [];
  const body = await api<{ rooms: ChargeableRoom[] }>(
    `/api/hotels/${hotelId}/till/rooms`,
  );
  return body.rooms;
}

/* ── Writes ───────────────────────────────────────────────────────── */

/**
 * Every write goes through here.
 *
 * A 409 from the till is not a failure, it is an ANSWER — the room has
 * two guests, the dish is off today, the bill is already paid. `api`
 * throws on any non-2xx, so the reason has to be recovered here rather
 * than lost as a generic error. The same shape `setHousekeeping` uses.
 */
async function write(path: string, body?: unknown): Promise<TillResult> {
  try {
    const result = await api<Order & { ok: true; guest?: string; room?: string }>(
      path,
      {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      ok: true,
      order: result,
      ...(result.guest ? { guest: result.guest } : {}),
      ...(result.room ? { room: result.room } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as
        | { reason?: string; choices?: { folioId: string; guest: string; company?: string | null }[] }
        | undefined;
      return {
        ok: false,
        reason: payload?.reason ?? error.message,
        ...(payload?.choices ? { choices: payload.choices } : {}),
      };
    }
    throw error;
  }
}

export function openOrder(
  hotelId: string, outlet: string, table?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders`, { outlet, table });
}

/** A parcel (the owner's D27-359): an order named by its customer, no table. */
export function openParcel(
  hotelId: string, outlet: string, name: string, phone: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders`, { outlet, parcel: { name, phone: phone.trim() || null } });
}

export function addLine(
  hotelId: string, orderId: string, itemId: string, qty: number,
  note?: string,
  /* Chosen in the dish dialog. A dish WITH variations requires one and
     the server refuses without it; a dish with none must not be sent
     one. Sides always start a new line rather than joining one whose
     add-ons nobody checked. */
  variationId?: string, addonIds?: string[],
  /** The choice of each further type (D27-192). */
  moreChoiceIds?: string[],
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/lines`,
    { itemId, qty, note, variationId, addonIds, moreChoiceIds });
}

/* ── In-room dining (D27-224): the guests' orders the Terminal answers ── */
export interface GuestOrder {
  id: string; room: string | null; note: string | null; createdAt: string;
  lines: { name: string; qty: number; unitPrice: number }[];
}

export async function listGuestOrders(hotelId: string): Promise<GuestOrder[]> {
  if (!hotelId) return [];
  return (await api<{ orders: GuestOrder[] }>(`/api/hotels/${hotelId}/till/guest-orders`)).orders;
}

/** Accept and send: the batch route builds the round from the guest's own
    basket, a room-service order for their room (Q4), sent at once. */
export function acceptGuestOrder(hotelId: string, guestOrderId: string): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/batch`, { guestOrderId });
}

/** Declined, with the reason the guest reads on their page. */
export function declineGuestOrder(
  hotelId: string, id: string, reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/guest-orders/${id}/decline`, { reason });
}

/** The waiter carried these Ready dishes out: they are served (D27-222).
    Only a ready dish; the server says why not. */
export function takeDishes(
  hotelId: string, orderId: string, lineIds: string[],
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/taken`, { lineIds });
}

/** `reason` is required once the kitchen has the dish, and only a manager
    may strike it then (D27-119); the server says so if not. */
export function voidLine(
  hotelId: string, orderId: string, lineId: string, reason?: string,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/void`,
    reason ? { reason } : undefined,
  );
}

/** A dish taken off after the kitchen had it (D27-119): Close restaurant
    day and the night audit list these. */
export interface StruckDish {
  orderNo: string;
  table: string | null;
  name: string;
  qty: number;
  /** Before tax, what it was sold at. */
  value: number;
  reason: string | null;
  by: string | null;
  at: string;
}

/** A bill given free, NC, that day (D27-351): who, when, why, and its value
    at menu prices, never a sale (D27-394). */
export interface NoChargeBill {
  orderNo: string;
  table: string | null;
  outlet: string;
  reason: string;
  /** null: a name the reader may not see (the owner's, to a GM; D27-9). */
  by: string | null;
  at: string;
  value: number;
}

/** A paid bill voided that day (D27-324): who, when, why and how much. */
export interface VoidedBill {
  orderNo: string;
  table: string | null;
  outlet: string;
  /** The bill as paid, round-off included. */
  amount: number;
  /** How it had been paid: cash, card, upi or split. */
  method: string | null;
  /** The part paid in cash: given back to the guest out of the
      restaurant's tin (D27-327). */
  cash: number;
  reason: string;
  /** The refund's reference for card or UPI; null for cash. */
  reference: string | null;
  /** Null: a name the reader may not see. */
  by: string | null;
  at: string;
}

/**
 * Change a line's quantity.
 *
 * Zero strikes it — a waiter counting down to none means the same as
 * pressing the cross, and the struck line stays visible either way.
 */
export function setLineQty(
  hotelId: string, orderId: string, lineId: string, qty: number,
  /** Fewer of a dish the kitchen has is a strike: a manager's, with a
      reason (D27-119). */
  reason?: string,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/qty`,
    { qty, ...(reason ? { reason } : {}) },
  );
}

/** Customise (D27-289): the numbered add-ons on a dish the kitchen does not
    have yet. The whole set each time; empty takes them all off. */
export function setNumberedAddons(
  hotelId: string, orderId: string, lineId: string, choices: NumberedChoice[],
  /** On a line of several, only ONE of them (D27-290): split off. */
  just?: 1,
  /** Typed add-ons chosen in the same Customise (D27-291): lines of their
      own under the dish, or under the one split off. */
  extras?: ExtraInput[],
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/numbered-addons`,
    { numberedAddons: choices, ...(just ? { just } : {}),
      ...(extras?.length ? { extras } : {}) },
  );
}

/** Add-ons as lines of their own under a dish already on the bill, sent or
    not (D27-291). They wait for the next Send like any new dish. */
export function addExtras(
  hotelId: string, orderId: string, lineId: string, extras: ExtraInput[],
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/orders/${orderId}/lines/${lineId}/extras`, { extras });
}

/** What staff typed as custom add-ons lately (D27-291): the Add-ons tab
    lists it, so the common ones can be numbered. */
export interface CustomAddonUsed {
  name: string; price: number; times: number; qty: number;
  lastAt: string; by: string | null;
}

export async function getCustomAddonsUsed(
  hotelId: string,
): Promise<{ days: number; used: CustomAddonUsed[] }> {
  return api(`/api/hotels/${hotelId}/till/custom-addons-used`);
}

/** The order screens' read of the menu: asked again whenever a screen opens
    or comes back into view (the owner's D27-290), as the add-ons are - a
    dish added or repriced on another device reached a device's pad only
    when its saved copy was replaced, up to a week later. The saved copy
    still answers with no signal. */
export const tillMenuQuery = (hotelId: string) => ({
  queryKey: ["till-menu", hotelId],
  queryFn: () => getMenu(hotelId),
  enabled: Boolean(hotelId),
  staleTime: 0,
  refetchOnWindowFocus: true,
});

/** The numbered Add-ons: the ones in use, or every one for the Menu tab. */
export async function getNumberedAddons(hotelId: string, all = false): Promise<NumberedAddon[]> {
  if (!hotelId) return [];
  return (await api<{ addons: NumberedAddon[] }>(
    `/api/hotels/${hotelId}/till/numbered-addons${all ? "?all=1" : ""}`)).addons;
}

/** The order screens' read of the Add-ons, ONE definition for the pad, the
    Till and the Terminal. ASKED AGAIN whenever a screen opens or comes back
    into view: the app's default trusts a read forever and keeps it a week,
    so a device that read the list before an add-on was made - on another
    device - offered none, and Customise said "No add-ons yet" (the owner, 9
    October: "the options are not coming for me"). The saved copy
    (App.tsx PERSISTED) still answers when there is no signal; a refusal for
    an add-on taken off since comes from the server, with its reason. */
export const numberedAddonsQuery = (hotelId: string) => ({
  queryKey: ["till-addons", hotelId],
  queryFn: () => getNumberedAddons(hotelId),
  enabled: Boolean(hotelId),
  staleTime: 0,
  refetchOnWindowFocus: true,
});

export interface NumberedAddonInput {
  number?: number;
  name?: string;
  description?: string | null;
  price?: number | null;
  free?: boolean;
  active?: boolean;
}

export function addNumberedAddon(
  hotelId: string, input: NumberedAddonInput,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/numbered-addons`, input);
}

export function changeNumberedAddon(
  hotelId: string, id: string, input: NumberedAddonInput,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/numbered-addons/${id}`, input, "PATCH");
}

export function numberedAddonOff(
  hotelId: string, id: string, until: OffFor, reason?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/numbered-addons/${id}/off`,
    { until, ...(reason ? { reason } : {}) });
}

export function numberedAddonOn(
  hotelId: string, id: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/numbered-addons/${id}/on`);
}

/**
 * Send the pending lines to the kitchen.
 *
 * KOT and BILL are different acts. Only PENDING lines go — firing the
 * whole order again would put the starters back on the pass while they
 * are being eaten.
 */
export async function sendToKitchen(
  hotelId: string, orderId: string,
): Promise<TillResult & { kotNo?: number }> {
  /* The docket number comes back with the send, so the till can offer
     the paper without asking again — and so a waiter who wants it knows
     which number to expect out of the machine. */
  try {
    const result = await api<Order & { ok: true; kotNo: number }>(
      `/api/hotels/${hotelId}/till/orders/${orderId}/kot`, { method: "POST" });
    return { ok: true, order: result, kotNo: result.kotNo };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/**
 * Discount an open bill.
 *
 * A discount is allowed and it must say WHY. A till with nowhere to record
 * one does not stop discounts happening — it moves them somewhere invisible,
 * and the biller strikes a line instead.
 */
export function applyDiscount(
  hotelId: string, orderId: string,
  type: "percent" | "fixed", value: number, reason: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/discount`,
    { type, value, reason });
}

/* ══════════════════════════════════════════════════════════════════
   PROMOTIONS — the discounts a restaurant gives again and again

   A NAMED promotion is decided once and applied by code, so the bill
   and the month-end report say the same thing. Since D27-395 (the owner,
   5 November) there is no 10% limit by hand either: the GM, the owner or
   an Admin may take any amount off, with a reason. (It was a free hand
   up to 10% and a promotion above it, the owner's rule of 9 September.)
   ══════════════════════════════════════════════════════════════════ */

export interface Promotion {
  id: string;
  /** What the biller types. Short — a terminal has a queue behind it. */
  code: string;
  /** What prints on the bill and groups the report. */
  name: string;
  kind: "percent" | "fixed";
  value: number;
  isActive: boolean;
  /** Bills that used it at this property. */
  used: number;
}

export interface PromotionList {
  promotions: Promotion[];
}

export async function listPromotions(
  hotelId: string,
): Promise<PromotionList> {
  return api<PromotionList>(`/api/hotels/${hotelId}/till/promotions`);
}

/** Applies a named promotion by its code. Goes past the free-hand cap,
    because somebody decided it in advance. */
export function applyPromotion(
  hotelId: string, orderId: string, code: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/promotion`,
    { code });
}

export async function addPromotion(
  hotelId: string,
  input: { code: string; name: string; kind: "percent" | "fixed"; value: number },
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/promotions`, input);
}

/** The CODE cannot be changed, deliberately: bills already printed name
    it, and a code reused for something else makes last month's bills
    describe this month's policy. Switch it off and make a new one. */
export async function amendPromotion(
  hotelId: string, id: string,
  input: { name?: string; value?: number; isActive?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/promotions/${id}`, {
      method: "PATCH", body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export function clearDiscount(
  hotelId: string, orderId: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/discount/clear`);
}

/** To the nearest rupee, so the biller takes a note rather than coins. */
export function setRoundOff(
  hotelId: string, orderId: string, apply: boolean,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/round-off`,
    { apply });
}

export async function getKitchen(hotelId: string): Promise<KitchenLine[]> {
  if (!hotelId) return [];
  const body = await api<{ lines: KitchenLine[] }>(
    `/api/hotels/${hotelId}/kitchen`,
  );
  return body.lines;
}

export async function moveKitchenLine(
  hotelId: string, lineId: string, to: "preparing" | "ready",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/kitchen/lines/${lineId}/${to}`,
      { method: "POST" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** D25-40 (Rule 159): asked when more than ₹1,00,000 of a bill is cash. */
export interface CashId {
  pan?: string;
  form97?: boolean;
  nonResident?: boolean;
}

export function settleOrder(
  hotelId: string, orderId: string,
  /** "function" — onto the banquet function the order is on, whole
      (D17-21). The server refuses every other method for such an order. */
  method: "room" | "cash" | "card" | "upi" | "function",
  room?: string, folioId?: string, cashId: CashId = {},
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`,
    { method, room, folioId, ...cashId });
}

/* ── The owner's restaurant allowance (D27-355, D27-365, D27-366) ── */
export interface OwnerAllowance {
  monthly: number | null; offPct: number | null; month: string; used: number; left: number | null;
  mayEdit: boolean; maySettle: boolean;
  bills: { orderNo: string; date: string; free: number; discount: number; paid: number }[];
}
export interface AllowancePlan {
  ok: true; monthly: number; offPct: number | null; left: number;
  before: number; discountNet: number; after: number; free: number; rest: number; reason: string | null;
}
export const getOwnerAllowance = (hotelId: string) =>
  api<OwnerAllowance>(`/api/hotels/${hotelId}/till/owner-allowance`);
export async function setOwnerAllowance(hotelId: string, monthly: number | null, offPct: number | null): Done {
  try {
    await api(`/api/hotels/${hotelId}/till/owner-allowance`,
      { method: "PUT", body: JSON.stringify({ monthly, offPct }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: (error.body as { reason?: string } | undefined)?.reason ?? error.message };
    throw error;
  }
}
export async function getAllowancePlan(hotelId: string, orderId: string): Promise<AllowancePlan | { ok: false; reason: string }> {
  try {
    return await api<AllowancePlan>(`/api/hotels/${hotelId}/till/orders/${orderId}/owner-allowance`);
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: (error.body as { reason?: string } | undefined)?.reason ?? error.message };
    throw error;
  }
}
/** Settled to the owner's allowance: the server works out the free part; `rest` pays the part above it. */
export function settleToAllowance(
  hotelId: string, orderId: string, rest: { method: "cash" | "card" | "upi"; tendered?: number }, cashId: CashId = {},
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`, { method: "allowance", rest, ...cashId });
}
/** A bill on the owner's allowance, in words (D27-366): "₹900.00 free on the owner's allowance, ₹540.00 by cash". */
export function allowanceWords(tenders: readonly { method: string; amount: number }[] | undefined): string | null {
  if (!tenders?.some((t) => t.method === "allowance")) return null;
  const by: Record<string, string> = { cash: "cash", card: "card", upi: "UPI" };
  const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return tenders.map((t) => (t.method === "allowance" ? `${rupees(t.amount)} free on the owner's allowance`
    : `${rupees(t.amount)} by ${by[t.method] ?? t.method}`)).join(", ");
}

/** What the biller is handing the till for one of several payments. */
export interface TenderInput {
  method: "room" | "cash" | "card" | "upi";
  amount: number;
  /** Cash only. The change is worked out from it. */
  tendered?: number;
  /** Card last four, a UPI reference. Never validated — the shape differs
      per method and a wrong format must not stop a guest leaving. */
  reference?: string;
}

/**
 * Settle a bill across several payments — the Part button.
 *
 * They must add up to the payable exactly. Short is a drawer that will not
 * reconcile at day end; over is change that was never given.
 *
 * A room payment has to be the ONLY one. Paying part of a bill to a room
 * would mean apportioning that part across tax rates again, and there is no
 * defensible way to choose which rate a partial payment settles.
 */
export function settleSplit(
  hotelId: string, orderId: string, tenders: TenderInput[], cashId: CashId = {},
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/settle`,
    { tenders, ...cashId });
}

export function abandonOrder(
  hotelId: string, orderId: string, reason: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/abandon`,
    { reason });
}

/** TABLE SHIFTING (D27-370): this open order to a free table of its section. */
export function moveOrder(hotelId: string, orderId: string, tableId: string): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/move`, { tableId });
}

/** The open order on that table comes onto this one, and is closed as joined - for good (D27-370). */
export function joinTable(hotelId: string, orderId: string, tableId: string): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/join`, { tableId });
}

/** VOID A PAID BILL (D27-324): the owner, an administrator or the GM, the
    same business day, with a reason; a card or UPI bill with the refund's
    reference. The server refuses everyone else and says why. */
export function voidPaidBill(
  hotelId: string, orderId: string, reason: string, reference?: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/void`,
    { reason, ...(reference ? { reference } : {}) });
}

/* ── Sent to the GM (the owner's D27-363) ──────────────────────────── */
/** Who may strike a dish the kitchen has, as the server asks (till.ts
    STRIKES_SENT); anyone else sends it to the GM. */
export const STRIKES_SENT: readonly string[] = ["owner", "admin", "gm", "hotel_manager", "kitchen_manager"];
export type PosRequestKind = "strike_line" | "discount" | "no_charge" | "void_bill";
export interface PosRequest {
  id: string; kind: PosRequestKind; lineId: string | null; summary: string;
  status: "pending" | "approved" | "rejected"; note: string | null; decidedBy: string | null;
}

/** A waiter or cashier sends the GM what they may not do themselves. */
export async function sendToGm(
  hotelId: string, orderId: string,
  body: { kind: PosRequestKind; reason: string; lineId?: string; type?: "percent" | "fixed"; value?: number; reference?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/orders/${orderId}/requests`, { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** A paid bill's payment mode changed before the night audit: the GM, the
    owner or an Admin, with a reason (D27-363). */
export async function changePaymentMode(
  hotelId: string, orderId: string, changes: { tenderId: string; method: string }[], reason: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/orders/${orderId}/tenders/change`,
      { method: "POST", body: JSON.stringify({ changes, reason }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** NC, NO CHARGE (D27-351): the owner, an administrator or the GM closes an
    open bill as given free, with a reason. The server refuses everyone else
    and says why. */
export function giveNoCharge(
  hotelId: string, orderId: string, reason: string,
): Promise<TillResult> {
  return write(`/api/hotels/${hotelId}/till/orders/${orderId}/no-charge`, { reason });
}

/* ── The menu, as the hotel maintains it ──────────────────────────── */

export async function addCategory(
  hotelId: string, name: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/categories`,
      { method: "POST", body: JSON.stringify({ name }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export async function addItem(
  hotelId: string, categoryId: string, name: string,
  price: number, taxRate: number, free = false,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/items`, {
      method: "POST",
      /* free: a dish at 0 only when ticked Free (X-1, D27-120). */
      body: JSON.stringify({ categoryId, name, price, taxRate, ...(free ? { free } : {}) }),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

/* ── How long a dish takes ────────────────────────────────────────
   `null` CLEARS, and that is a real act rather than a no-op: the dish
   falls back to its category again. Both functions take
   `number | null` for exactly that reason — there is no way to spell
   "leave it alone" here, because leaving it alone is not calling
   this. */

export function setItemPrepMinutes(
  hotelId: string, itemId: string, minutes: number | null,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/menu/items/${itemId}/prep`, { minutes },
  );
}

/** Returns how many dishes actually moved — a default that changes
    nothing because every dish overrides it is worth saying out loud. */
export function setCategoryPrepMinutes(
  hotelId: string, categoryId: string, minutes: number | null,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/menu/categories/${categoryId}/prep`,
    { minutes },
  );
}

/* ── Which course a dish belongs to ───────────────────────────────
   `null` clears and falls back, exactly as the preparation times do —
   and on a CATEGORY, null means "not part of the sequence", which is
   what a drinks list wants. */

export function setItemCourse(
  hotelId: string, itemId: string, course: number | null,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/menu/items/${itemId}/course`, { course },
  );
}

export function setCategoryCourse(
  hotelId: string, categoryId: string, course: number | null,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/menu/categories/${categoryId}/course`,
    { course },
  );
}

/** A section's tax heading, from the Menu screen (D22-4). */
export function setCategoryTaxKind(
  hotelId: string, categoryId: string, kind: SectionHeading,
): Promise<TillResult> {
  return write(
    `/api/hotels/${hotelId}/till/menu/categories/${categoryId}/tax-kind`,
    { kind },
  );
}

export async function toggleItem(
  hotelId: string, itemId: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(`/api/hotels/${hotelId}/till/menu/items/${itemId}/toggle`,
      { method: "POST" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

/* ── Off, and back on ─────────────────────────────────────────────
   `toggleItem` above is the PERMANENT one: a dish taken off the card,
   which is a menu decision. This is the shift decision — out of paneer
   until eight — and it is a different act with a different word for it.

   A DURATION, never a switch. Off with no end is a dish that stays off
   for a week because whoever took it off went home, and nobody can say
   since when. */

export type OffFor = "2h" | "4h" | "8h" | "24h" | "next_business_day" | "custom";

export async function takeItemOff(
  hotelId: string, itemId: string, until: OffFor,
  reason?: string, customUntil?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(
    `/api/hotels/${hotelId}/till/menu/items/${itemId}/off`,
    { until, reason, customUntil });
}

export async function putItemBack(
  hotelId: string, itemId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/menu/items/${itemId}/on`);
}

/* The same act for an ADD-ON — out of onions until eight. POS-2: these two
   routes were built with 045 and nothing called them, so a side could be
   switched off only in the database. The owner's D17-19 (17 September):
   switches on the Menu screen, like dishes have.

   ⚠ NO REASON. `pos_addons` has nowhere to keep one (045) and the route
   takes none, so nothing asks for one — a "Why" field whose answer is
   thrown away would be a lie to whoever typed it.

   ⚠ AN ADD-ON BELONGS TO A GROUP, AND A GROUP CAN BE ON SEVERAL DISHES.
   Switching one off switches it off on every dish that offers it. */
export async function takeAddonOff(
  hotelId: string, addonId: string, until: OffFor, customUntil?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(
    `/api/hotels/${hotelId}/till/addons/${addonId}/off`,
    { until, customUntil });
}

export async function putAddonBack(
  hotelId: string, addonId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/addons/${addonId}/on`);
}

/* ── Variations and add-on groups, as the kitchen manager keeps them ─
   The owner's D21-40 to D21-43 (21 September) and D27-192. Every price is
   the TEXT a person typed: the server refuses a blank rather than reading
   it as zero, and a 0 only when it is ticked Free (D27-120). */

type Done = Promise<{ ok: boolean; reason?: string }>;
const menuPath = (hotelId: string, rest: string) =>
  `/api/hotels/${hotelId}/till/menu/${rest}`;

export interface VariationSet {
  types: {
    kind: VariationKind;
    heading?: string;
    /** mrp: the first type's only, as typed - empty is none (D27-373). */
    choices: { id?: string; label: string; price: string; free: boolean; mrp?: string }[];
  }[];
  /** Needed when every type is removed: the dish is one price again. */
  dishPrice?: string;
  dishFree?: boolean;
}

/** A dish's whole set of variation types, saved at once (D27-192). */
export function saveVariations(hotelId: string, itemId: string, set: VariationSet): Done {
  return simplePost(menuPath(hotelId, `items/${itemId}/variations`), set, "PUT");
}

/** A dish's MRP (D27-373): null clears it to a dash. */
export function setItemMrp(hotelId: string, itemId: string, mrp: number | null): Done {
  return simplePost(menuPath(hotelId, `items/${itemId}/mrp`), { mrp });
}

/** Every group the hotel has, with the dishes that offer it — including
    a group on no dish yet, which the menu read cannot show. */
export interface AddonGroupSetup extends AddonGroup {
  itemIds: string[];
}

export async function listAddonGroups(hotelId: string): Promise<AddonGroupSetup[]> {
  if (!hotelId) return [];
  const body = await api<{ groups: AddonGroupSetup[] }>(
    menuPath(hotelId, "addon-groups"));
  return body.groups;
}

export interface GroupRule { label: string; minSelect: number; maxSelect: number | null }

export function addAddonGroup(hotelId: string, rule: GroupRule): Done {
  return simplePost(menuPath(hotelId, "addon-groups"), rule);
}

export function editAddonGroup(hotelId: string, id: string, rule: GroupRule): Done {
  return simplePost(menuPath(hotelId, `addon-groups/${id}`), rule, "PATCH");
}

/** The whole list of dishes that offer the group, replacing the last. */
export function setGroupDishes(hotelId: string, id: string, itemIds: string[]): Done {
  return simplePost(menuPath(hotelId, `addon-groups/${id}/dishes`), { itemIds });
}

export function addAddonOption(
  hotelId: string, groupId: string, label: string, price: string, free: boolean,
): Done {
  return simplePost(menuPath(hotelId, `addon-groups/${groupId}/addons`), { label, price, free });
}

export function editAddonOption(
  hotelId: string, id: string, label: string, price: string, free: boolean,
): Done {
  return simplePost(menuPath(hotelId, `addons/${id}`), { label, price, free }, "PATCH");
}

export function removeAddonOption(hotelId: string, id: string): Done {
  return simplePost(menuPath(hotelId, `addons/${id}/remove`));
}

export async function setOutletClosed(
  hotelId: string, outlet: string,
  closed: boolean, until?: OffFor, reason?: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(
    `/api/hotels/${hotelId}/till/outlet/${outlet}/closed`,
    { closed, until, reason });
}

/** A refusal a person can act on, or nothing. The shape used by every
    write on this page that has no order to hand back. */
async function simplePost(
  path: string, body?: unknown, method = "POST",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await api(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/* ── The floor ────────────────────────────────────────────────────
   Every table with whatever is sitting on it, in one request. A grid
   that fetched a tile at a time would flicker as it filled, and a
   waiter reads the whole room at once or not at all. */

/** blank · running · kot · printed · paid · closed — DERIVED from the
    order, never stored. A stored colour is a sixth thing to keep in step,
    and the one that will be wrong on the night a manager is watching.
    `closed` is a bill closed unpaid whose table is not yet cleared (POS-33);
    `joined`, a table joined to another's bill until that bill is settled (D27-372). */
export type TableState = "blank" | "running" | "kot" | "printed" | "paid" | "closed" | "joined";

export interface FloorTable {
  id: string;
  label: string;
  seats: number | null;
  row: number;
  col: number;
  orderId: string | null;
  orderNo: string | null;
  state: TableState;
  /** How long the table has been sitting. The number a manager scans
      the room for. Null when nothing is on it. */
  minutes: number | null;
  payable: number | null;
  /** Dishes the kitchen made Ready that nobody has Taken (D27-221), and
      their lines. Absent on a floor cached before 1 October: none. */
  ready?: number;
  readyIds?: string[];
  /** A joined table's: the table whose bill it went onto (D27-372). Its
      orderId and orderNo are that bill's. */
  joinedTo?: string | null;
}

export interface FloorSection {
  id: string;
  name: string;
  tables: FloorTable[];
}

export interface Floor {
  outlet: {
    code: string; name: string;
    /** When it reopens. Null when it is open. */
    closedUntil: string | null;
    /** Why, if anybody said. Null is ordinary and shows nothing —
        it is not "no reason", it is "nobody wrote one". */
    closedReason: string | null;
  } | null;
  sections: FloorSection[];
  /** The open parcels (D27-359), oldest first. Absent on an older server: none. */
  parcels?: FloorParcel[];
}

export interface FloorParcel {
  orderId: string; orderNo: string;
  /** The customer's name. */
  name: string; phone: string | null;
  minutes: number; payable: number;
  ready: number; readyIds: string[];
}

export async function getFloor(
  hotelId: string, outlet = "REST",
): Promise<Floor> {
  if (!hotelId) return { outlet: null, sections: [] };
  return api<Floor>(
    `/api/hotels/${hotelId}/till/floor?outlet=${encodeURIComponent(outlet)}`);
}

/* ── Restaurant setup (D22-6) ─────────────────────────────────────
   The restaurant's name, its sections and tables. Nothing is deleted: a
   section or table taken away is switched off, and the server refuses it
   while a bill sits on it. */

export interface SetupTable {
  id: string;
  label: string;
  /** Null when nobody typed it: a dash, never a number. */
  seats: number | null;
  /** A bill sits on it - open, or paid and not yet cleared. */
  busy: boolean;
}

export interface TillSetup {
  /** Null until somebody names it: there is no restaurant yet. */
  restaurant: { name: string; packingCharge?: number | null } | null;
  /** Every section switched on, an empty one included. */
  sections: { id: string; name: string; tables: SetupTable[] }[];
  /** People with the Waiter role here. */
  waiters: number;
}

export async function getTillSetup(hotelId: string): Promise<TillSetup> {
  return api<TillSetup>(`/api/hotels/${hotelId}/till/setup`);
}

const setupPath = (hotelId: string, rest: string) =>
  `/api/hotels/${hotelId}/till/setup/${rest}`;

export function nameRestaurant(hotelId: string, name: string): Done {
  return simplePost(setupPath(hotelId, "restaurant"), { name });
}

/** A parcel's packing charge (D27-359): once per parcel; null for none. */
export function setPackingCharge(hotelId: string, amount: number | null): Done {
  return simplePost(setupPath(hotelId, "packing"), { amount });
}

export function addSection(hotelId: string, name: string): Done {
  return simplePost(setupPath(hotelId, "sections"), { name });
}

export function renameSection(hotelId: string, id: string, name: string): Done {
  return simplePost(setupPath(hotelId, `sections/${id}`), { name }, "PATCH");
}

export function takeSectionAway(hotelId: string, id: string): Done {
  return simplePost(setupPath(hotelId, `sections/${id}/off`));
}

/** One table (`label`), or a numbered run: `prefix` from `from` to `to`.
    Every figure is the TEXT typed; the server refuses a blank. */
export function addTables(
  hotelId: string, sectionId: string,
  tables: { label: string } | { prefix: string; from: string; to: string },
  seats: string,
): Done {
  return simplePost(setupPath(hotelId, `sections/${sectionId}/tables`), { ...tables, seats });
}

export function changeTable(hotelId: string, id: string, label: string, seats: string): Done {
  return simplePost(setupPath(hotelId, `tables/${id}`), { label, seats }, "PATCH");
}

export function takeTableAway(hotelId: string, id: string): Done {
  return simplePost(setupPath(hotelId, `tables/${id}/off`));
}

/* ══════════════════════════════════════════════════════════════════
   A WHOLE ROUND, IN ONE REQUEST

   What the order pad sends. Six dishes cost ONE journey to the server
   instead of six, which on a hill-station link is the difference
   between an order taking a moment and an order taking a minute.

   All-or-nothing at the far end: if the fourth dish is refused, the
   first three are rolled back. Half an order on a bill is worse than
   none — the waiter believes six went, the kitchen cooks three, and
   nobody finds out until the table complains.
   ══════════════════════════════════════════════════════════════════ */

export interface SendLine {
  /** The dish. Absent on add-ons for a dish already on the bill (extraFor). */
  itemId?: string;
  qty: number;
  note?: string;
  /* A dish WITH variations requires one and the server refuses without
     it; a dish with none must not be sent one. */
  variationId?: string;
  /** The choice of each further type (D27-192). */
  moreChoiceIds?: string[];
  addonIds?: string[];
  /** The numbered Add-ons on this dish (D27-289). */
  numberedAddons?: NumberedChoice[];
  /** Add-ons as lines of their own (D27-291): under this dish, or with
      extraFor under a dish already on the bill. */
  extras?: ExtraInput[];
  extraFor?: string;
}

/**
 * ⚠ THREE OUTCOMES, NOT TWO, and the third is the one that matters.
 *
 * `held` is an order that never reached the server because there was no
 * connection. It is in the outbox and will go when the line is back —
 * but THE KITCHEN DOES NOT HAVE IT, and there is no docket number,
 * because no server has seen it. A pad that reports this as "sent"
 * tells a waiter the food is being cooked when nothing is.
 */
export type SendResult =
  | { ok: true; held: false; order: Order; opened: boolean; kotNo: number | null }
  | { ok: true; held: true; message: string }
  | { ok: false; reason: string };

export async function sendOrder(
  hotelId: string,
  input: {
    /** Absent when joining an order already open on the table. */
    outlet?: string;
    /** A second round on an existing bill. */
    orderId?: string;
    tableId?: string;
    table?: string;
    orderType?: string;
    lines: SendLine[];
    /** Straight to the kitchen in the same breath. A waiter who has
        finished taking an order has finished. */
    send?: boolean;
    /** The banquet function this order goes on (D17-21). Null takes an
        open order off its function; absent leaves it as it is. */
    eventId?: string | null;
  },
): Promise<SendResult> {
  try {
    const result = await api<
      Order & { ok: true; opened: boolean; sent?: number; kotNo?: number }
    >(`/api/hotels/${hotelId}/till/orders/batch`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return {
      ok: true,
      held: false,
      order: result,
      opened: result.opened,
      /* Null rather than zero when nothing was sent to the kitchen. A
         zero here would print as a docket number. */
      kotNo: typeof result.kotNo === "number" ? result.kotNo : null,
    };
  } catch (error) {
    if (error instanceof HeldError) {
      return { ok: true, held: true, message: error.message };
    }
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/** Frees the table. Refused while the bill is unsettled — clearing one
    takes a live order off the floor with money on it. */
export async function clearTable(
  hotelId: string, orderId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return simplePost(`/api/hotels/${hotelId}/till/orders/${orderId}/clear`);
}

/* ── The order header ─────────────────────────────────────────────
   ONE call for five fields, because they are one panel. Four calls
   would mean a waiter who fills it in and taps away produces four
   writes, three of which can fail on their own and leave the header
   half entered with nothing saying which half.

   Only what is PASSED is written — sending `covers` must not blank the
   waiter somebody set a minute ago. */
export interface OrderHeader {
  covers?: number | null;
  waiterId?: string | null;
  orderType?: Order["orderType"];
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerLocality?: string | null;
  held?: boolean;
  /** The banquet function (D17-21). Null takes the order off it. */
  eventId?: string | null;
}

export async function setOrderHeader(
  hotelId: string, orderId: string, header: OrderHeader,
): Promise<TillResult> {
  try {
    const result = await api<Order & { ok: true }>(
      `/api/hotels/${hotelId}/till/orders/${orderId}`,
      { method: "PATCH", body: JSON.stringify(header) },
    );
    return { ok: true, order: result };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/** Everyone with access to this property. Nobody holds a `waiter` role,
    and inventing one would leave the list empty on the first evening —
    the same answer housekeeping gives, for the same reason. */
export async function listWaiters(
  hotelId: string,
): Promise<{ id: string; name: string }[]> {
  if (!hotelId) return [];
  const body = await api<{ waiters: { id: string; name: string }[] }>(
    `/api/hotels/${hotelId}/till/waiters`);
  return body.waiters;
}

/* ── The kitchen docket ───────────────────────────────────────────
   One BATCH of lines, not the order. Starters, then mains, then the
   dessert somebody changed their mind about: three dockets, three
   numbers, one bill.

   No prices on it, and there never will be. A chef reading a docket is
   deciding what to cook and in what order; a column of rupees is noise
   on a rail above a hotplate. */
export interface Docket {
  kotNo: number;
  /** Which slip of the docket (D27-292): its name heads the paper, "BAR KOT
      14". Null or absent: the whole docket, headed "KOT". */
  kind?: { id: string; name: string } | null;
  /** Printed again from the list: the paper says REPRINT (D27-292). */
  reprint?: boolean;
  orderNo: string;
  table: string | null;
  orderType: string;
  outlet: string;
  hotel: string;
  sentAt: string | null;
  /** For the KOT's design to print (D27-368). Absent on an older docket. */
  covers?: number | null;
  waiter?: string | null;
  lines: {
    id: string;
    /** Set on a side, naming the dish it goes on. The paper indents. */
    parentId: string | null;
    name: string;
    qty: number;
    note: string | null;
    isAddon: boolean;
    /** "+ Kebab" under the dish (D27-289). Absent on an older docket. */
    plus?: { name: string; qty: number }[];
    /** An add-on as a line of its own, with its own number (D27-291). */
    extra?: boolean;
    /** Its dish, when that went on an earlier KOT (D27-291). */
    for?: { name: string; kotNo: number | null };
  }[];
  /** Taken off this docket after it was sent, and why (D27-119). */
  struck?: { name: string; qty: number; reason: string | null }[];
}

export async function getDocket(
  hotelId: string, orderId: string, kotNo: number,
  /** One kind's slip (D27-292). */
  kindId?: string,
): Promise<Docket | null> {
  if (!hotelId || !orderId || !Number.isInteger(kotNo)) return null;
  return api<Docket>(
    `/api/hotels/${hotelId}/till/orders/${orderId}/kot/${kotNo}${kindId ? `?kind=${kindId}` : ""}`);
}

/* ── The KOT section of Restaurant setup (D27-292) ────────────────
   KOT kinds (Kitchen, Bar, and any added), the computers that print them -
   one computer per kind - which menu section prints on which, and the bill
   printer. `device` is this browser's own id (components/KotStation.tsx). */
export interface KotStationRef {
  id: string; name: string; mine: boolean; online: boolean; seenAt: string | null;
}

export interface KotKind {
  id: string;
  name: string;
  role: "food" | "bar" | null;
  /** Kitchen and Bar: renamed, never switched off. */
  fixed: boolean;
  station: KotStationRef | null;
  /** Sections with a dish on sale that print on it: the red line shows only
      for a kind something prints to (the owner). */
  sections: number;
}

export interface KotSetup {
  kinds: KotKind[];
  /** slipMm: the computer's shortest slip in mm (D27-363); null, the system's. */
  stations: (KotStationRef & { printsBills: boolean; kinds: string[]; slipMm?: number | null })[];
  /** Each menu section: the kind it names (`own`, or null to follow its
      heading) and the kind it prints on. */
  sections: { id: string; name: string; heading: SectionHeading | null; own: string | null; kind: string | null }[];
  billPrinter: KotStationRef | null;
  /** This computer's station, when it is one. */
  me: string | null;
  /** The KOT's design (D27-368); absent from an older server: today's KOT. */
  design?: KotDesign;
}

/* ── The KOT's design (the owner's D27-368) ── */
export type KotSize = "small" | "normal" | "large";
export interface KotDesign {
  dishSize: KotSize; numberSize: KotSize;
  show: { waiter: boolean; covers: boolean; time: boolean; kind: boolean; notes: boolean; orderNo: boolean };
  heading: string | null; widthMm: 58 | 80;
}
/** Today's KOT, as the server reads a hotel with no design (kotDesign.ts KOT_TODAY). */
export const KOT_TODAY: KotDesign = {
  dishSize: "normal", numberSize: "normal",
  show: { waiter: false, covers: false, time: true, kind: true, notes: true, orderNo: true },
  heading: null, widthMm: 80,
};
export const setKotDesign = (hotelId: string, design: KotDesign): Plain =>
  plainPost(`/api/hotels/${hotelId}/till/kot-setup/design`, design, "PUT");

export async function getKotSetup(hotelId: string, device: string): Promise<KotSetup> {
  return api<KotSetup>(
    `/api/hotels/${hotelId}/till/kot-setup?device=${encodeURIComponent(device)}`);
}

async function plainPost<T>(
  path: string, body: unknown, method = "POST",
): Promise<T | { ok: false; reason: string }> {
  try {
    return await api<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

type Plain = Promise<{ ok: true } | { ok: false; reason: string }>;
const KOT = (hotelId: string) => `/api/hotels/${hotelId}/till/kot-setup`;

export const addKotKind = (hotelId: string, name: string): Plain =>
  plainPost(`${KOT(hotelId)}/kinds`, { name });
export const renameKotKind = (hotelId: string, id: string, name: string): Plain =>
  plainPost(`${KOT(hotelId)}/kinds/${id}`, { name }, "PATCH");
export const kotKindOff = (hotelId: string, id: string): Plain =>
  plainPost(`${KOT(hotelId)}/kinds/${id}/off`, {});
/** Null sends the section back to its heading. */
export const setSectionKot = (hotelId: string, sectionId: string, kindId: string | null): Plain =>
  plainPost(`${KOT(hotelId)}/sections/${sectionId}`, { kindId });
/** The kinds and the bills this computer prints, under its name. Ticked
    here, they move here from any other computer. Nothing ticked: it stops. */
export const setThisComputer = (
  hotelId: string, device: string, name: string, kindIds: string[], bills: boolean,
): Plain => plainPost(`${KOT(hotelId)}/this-computer`, { device, name, kindIds, bills });
/** A computer's shortest slip (D27-363); null puts back the system's. */
export const setStationSlip = (hotelId: string, id: string, slipMm: number | null): Plain =>
  plainPost(`/api/hotels/${hotelId}/till/kot-setup/stations/${id}/print`, { slipMm });

export const removeKotStation = (hotelId: string, id: string): Plain =>
  plainPost(`${KOT(hotelId)}/stations/${id}/remove`, {});

/** One kind's slip of a docket, as the station's list carries it. */
export interface KotSlipRef {
  orderId: string;
  kotNo: number;
  kindId: string;
  kind: string;
  table: string | null;
  sentAt: string;
  printedAt: string | null;
}

export interface BillJob {
  id: string;
  orderId: string;
  heading: BillHeading;
  table: string | null;
}

/** A KOT slip asked to print again at this computer (D27-329 (2)). */
export interface KotReprintJob {
  id: string;
  orderId: string;
  kotNo: number;
  kindId: string;
  kind: string;
  table: string | null;
}

/** The station's ask: it is also its "last seen". `due` oldest first. */
export async function pollKotStation(
  hotelId: string, device: string,
): Promise<
  | { station: false }
  | { station: { id: string; name: string; kinds: { id: string; name: string }[]; printsBills: boolean };
      due: KotSlipRef[]; recent: KotSlipRef[]; bills: BillJob[];
      /** Absent from a server before 15 October. */
      reprints?: KotReprintJob[] }
> {
  return api(`/api/hotels/${hotelId}/till/kot-stations/poll`,
    { method: "POST", body: JSON.stringify({ device }) });
}

/** The claim before the paper: true means print it; false, another tab
    has, or this computer no longer prints that kind. */
export async function claimKot(
  hotelId: string, orderId: string, kotNo: number, kindId: string, device: string,
): Promise<boolean> {
  const res = await plainPost<{ ok: true; claimed: boolean }>(
    `/api/hotels/${hotelId}/till/orders/${orderId}/kot/${kotNo}/printed`, { device, kind: kindId });
  return res.ok && res.claimed;
}

/** Reprint a KOT's slip at the computer that prints its kind (the owner's
    D27-329 (2)): it waits there and prints marked REPRINT - never on this
    device. `station.online` false: it prints when that computer is back. */
export const askKotReprint = (hotelId: string, orderId: string, kotNo: number, kindId: string | null) =>
  plainPost<{ ok: true; station: { name: string; online: boolean; seenAt: string | null } }>(
    `/api/hotels/${hotelId}/till/orders/${orderId}/kot/${kotNo}/reprint`, { kind: kindId });

/** The station's claim of a reprint before the paper. */
export async function claimKotReprint(hotelId: string, id: string, device: string): Promise<boolean> {
  const res = await plainPost<{ ok: true; claimed: boolean }>(
    `/api/hotels/${hotelId}/till/kot-reprints/${id}/printed`, { device });
  return res.ok && res.claimed;
}

/** What a printed bill says it is (D27-292). "interim" is the print before
    payment; since D27-334 its paper says plain BILL, as a restaurant's does. */
export type BillHeading = "interim" | "bill" | "duplicate" | "void" | "nc";

/** The words at the top of the paper. */
export const BILL_TITLE: Record<BillHeading, string> = {
  interim: "Bill", bill: "Bill", duplicate: "Bill · duplicate", void: "Bill · VOID",
  nc: "NC · No charge",
};

/** The heading the next print of this order would carry, before asking. */
export const nextBillHeading = (o: Pick<Order, "status" | "billsPrinted">): BillHeading =>
  o.status === "void" ? "void"
    : o.status === "no_charge" ? "nc"
    : o.status !== "settled" ? "interim" : (o.billsPrinted ?? 0) > 0 ? "duplicate" : "bill";

/** Print bill (D27-292): asked of the bill printer. `sentTo` null - none is
    chosen - and the screen opens the bill as it always did. */
export const askBillPrint = (hotelId: string, orderId: string) =>
  plainPost<{
    ok: true; heading: BillHeading; jobId?: string;
    sentTo: { name: string; online: boolean } | null;
  }>(`/api/hotels/${hotelId}/till/orders/${orderId}/bill-print`, {});

/** Printed on this device - the bill page's Print here. A bill waiting at
    the bill printer comes off its list, and this is that print. */
export const printBillHere = (hotelId: string, orderId: string) =>
  plainPost<{ ok: true; heading: BillHeading }>(
    `/api/hotels/${hotelId}/till/orders/${orderId}/bill-print/here`, {});

/** The bill printer's claim before the paper. */
export async function claimBill(hotelId: string, jobId: string, device: string): Promise<boolean> {
  const res = await plainPost<{ ok: true; claimed: boolean }>(
    `/api/hotels/${hotelId}/till/bill-prints/${jobId}/printed`, { device });
  return res.ok && res.claimed;
}

/* ── The day end ──────────────────────────────────────────────────
   Three steps, as the screens have it:

     Day End Overview  →  Cash Calculations  →  Finalize

   The same shape as the night audit and deliberately not a second
   one. An open bill and an uncleared table are questions a person
   answers; a drawer that does not balance is not one of them — the
   money is already whatever it is, and a shift that cannot close is
   worse than a difference written down with a reason. */

export type MovementKind =
  | "expense"        // paid out: vegetables, a repair
  | "top_up"         // put in: change from the safe
  | "withdrawal"     // taken out: cash to the safe mid-shift
  | "due_collection"; // a bill settled to an account, paid later in cash

export interface DayEnd {
  outlet: { code: string; name: string };
  /** The hotel's operating day, not the clock. A close started at 00:40
      is closing the evening that is still being served. */
  businessDate: string;
  summary: {
    settledOrders: number;
    settledValue: number;
    abandonedOrders: number;
    abandonedValue: number;
    compOrders: number;
    discountGiven: number;
    byMethod: Record<string, number>;
  };
  /** What a PERSON must decide before this can close. Empty is the
      only state in which the Finalize button does anything. */
  blockers: { id: string; reason: string; detail: string | null }[];
  /** Food struck after the kitchen had it, with who and why (D27-119). */
  struck?: StruckDish[];
  /** Paid bills voided that day (D27-324). Left out of every figure in
      `summary`; their cash went back out of the tin (D27-327), so it is
      not in `cash.expected` either. */
  voided?: VoidedBill[];
  /** Bills given free, NC, that day (D27-351): left out of every figure in
      `summary`; each with its value at menu prices (D27-394). */
  noCharge?: NoChargeBill[];
  /** Paid bills whose payment mode was changed (D27-363); afterDayEnd: after the drawer was counted. */
  modeChanges?: { orderNo: string; table: string | null; from: string; to: string; amount: number;
    reason: string; by: string | null; at: string; afterDayEnd: boolean }[];
  movements: {
    id: string; kind: MovementKind; amount: number;
    /** null: a name the reader may not see (the owner's, to a GM; D27-9). */
    reason: string; recordedBy: string | null; at: string;
    /** A paid-out's yes (D27-242); null where nobody was asked. */
    approval?: string | null; approvalNote?: string | null;
    /** The petty cash book (D27-370): a paid-out's category, null on one
        from before it; whether its bill's photo is on it. */
    category?: string | null; photo?: boolean;
  }[];
  cash: {
    opening: number;
    /** Opening + cash taken + money in − money out. CASH ONLY: a card
        settlement never touched the tin. */
    expected: number;
    /** Null until somebody counts. Not zero — nobody counted zero. */
    counted: number | null;
    variance: number | null;
    /** Paid-outs waiting for a yes, not in `expected` yet (D27-242). */
    waiting?: number;
    varianceReason: string | null;
    denominations: { value: number; count: number }[];
  };
  /** False only on the outlet's first-ever day, before its one count (D27-200). */
  opened: boolean;
  closedAt: string | null;
  closedBy: string | null;
}

export async function getDayEnd(
  hotelId: string, outlet = "REST",
): Promise<DayEnd | null> {
  if (!hotelId) return null;
  return api<DayEnd>(
    `/api/hotels/${hotelId}/till/day-end?outlet=${outlet}`);
}

export async function recordMovement(
  hotelId: string,
  input: { outlet?: string; kind: MovementKind; amount: number; reason: string; category?: string },
): Promise<Refusal<{ id?: string }>> {
  return till(hotelId, "day-end/movements", input);
}

/** Open the day: an outlet's first float, counted once (D27-200). */
export async function openDay(
  hotelId: string, input: { outlet?: string; opening: number },
): Promise<Refusal> {
  return till(hotelId, "day-end/open", input);
}

/** The count, replaced wholesale. Somebody empties the tin and counts
    it — merging a new count into an old one leaves denominations
    nobody typed this time. */
export async function countDrawer(
  hotelId: string,
  input: { outlet?: string;
           denominations: { value: number; count: number }[] },
): Promise<Refusal> {
  return till(hotelId, "day-end/count", input);
}

export async function closeDay(
  hotelId: string,
  input: { outlet?: string; varianceReason?: string; keptCash: number },
): Promise<Refusal> {
  return till(hotelId, "day-end/close", input);
}

/** One shape for all three, because all three refuse the same way. */
type Refusal<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

async function till(
  hotelId: string, path: string, body: unknown,
): Promise<Refusal<{ id?: string }>> {
  try {
    const res = await api<{ id?: string } | null>(`/api/hotels/${hotelId}/till/${path}`, {
      method: "POST", body: JSON.stringify(body),
    });
    /* A movement's id, for the photo of its bill (D27-370). */
    return res?.id ? { ok: true, id: res.id } : { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/* ══════════════════════════════════════════════════════════════════
   IMPORTING A MENU

   Two passes on purpose. The first changes nothing and reports what
   WOULD happen; the screen shows that and only then sends the same
   payload to apply. A bulk write that happens the instant a file is
   chosen is how somebody replaces a card they meant to look at first.
   ══════════════════════════════════════════════════════════════════ */

export function importMenu(
  hotelId: string, rows: Record<string, string>[], dryRun: boolean,
): Promise<ImportReport> {
  return importFile(`/api/hotels/${hotelId}/till/menu/import`, rows, dryRun);
}

/** The add-ons file (D21-43): imported before the menu file that names
    its groups. */
export function importAddons(
  hotelId: string, rows: Record<string, string>[], dryRun: boolean,
): Promise<ImportReport> {
  return importFile(
    `/api/hotels/${hotelId}/till/menu/addon-groups/import`, rows, dryRun);
}

async function importFile(
  path: string, rows: Record<string, string>[], dryRun: boolean,
): Promise<ImportReport> {
  try {
    return await api<ImportReport>(
      path,
      { method: "POST", body: JSON.stringify({ rows, dryRun }) },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return {
        ok: false, reason: p?.reason ?? error.message, dryRun,
        verdicts: [], creates: 0, updates: 0, rejected: 0,
      };
    }
    throw error;
  }
}
