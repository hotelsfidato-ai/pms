import { api, ApiError } from "@/lib/api";
/* Money in the settings console (191, the owner's D27-259): the hotel's ways
   of paying, its extra charges, its room discounts and the commission each
   source and agent contract carries. */

export interface PaymentMethodRow {
  id: string; label: string;
  /** What it is in the books: a key of `kinds`. */
  kind: string;
  isActive: boolean;
  /** Payments were taken this way: switched Off, never deleted. */
  used: boolean;
}
export interface PaymentMethodsView {
  methods: PaymentMethodRow[];
  defaultMethod: string;
  kinds: Record<string, string>;
}

export interface ExtraCharge {
  id: string; name: string; description: string | null;
  /** Null: included at no charge - never a zero (065). */
  rate: number | null;
  category: string;
  isTransport: boolean;
  isActive: boolean;
  used: boolean;
}
export interface ExtraChargesView {
  charges: ExtraCharge[];
  earlyCheckinCharge: number | null;
  lateCheckoutCharge: number | null;
}

export interface Discount {
  id: string; name: string;
  /** Exactly one of the two: % or ₹ off each night. */
  percent: number | null; amount: number | null;
  isActive: boolean; used: boolean;
}

export interface CommissionView {
  sources: { id: string; name: string; kind: string; commissionPct: number | null }[];
  contracts: {
    id: string; name: string; companyId: string; company: string;
    validFrom: string; validTo: string | null; commissionPct: number;
  }[];
}

const base = (hotelId: string) => `/api/hotels/${hotelId}`;

export const getPaymentMethods = (h: string) => api<PaymentMethodsView>(`${base(h)}/payment-methods`);
export const getExtraCharges = (h: string) => api<ExtraChargesView>(`${base(h)}/extra-charges`);
export const getDiscounts = (h: string) => api<{ discounts: Discount[] }>(`${base(h)}/discounts`);
export const getCommission = (h: string) => api<CommissionView>(`${base(h)}/commission`);

/** What the desk may add, as the bill's Add charge offers it: those On (065). */
export const getChargeList = (h: string) =>
  api<{ inclusions: { id: string; name: string; rate: number | null; category: string }[] }>(
    `${base(h)}/inclusions`);

export type Result = { ok: true; id?: string } | { ok: false; reason: string };

async function send(path: string, method: string, body?: unknown): Promise<Result> {
  try {
    return await api<Result>(path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}

/** One of the lists: add, change, delete, put in order. */
export const moneyList = (hotelId: string, list: "payment-methods" | "extra-charges" | "discounts") => ({
  add: (body: object) => send(`${base(hotelId)}/${list}`, "POST", body),
  change: (id: string, body: object) => send(`${base(hotelId)}/${list}/${id}`, "PATCH", body),
  remove: (id: string) => send(`${base(hotelId)}/${list}/${id}`, "DELETE"),
  order: (ids: string[]) => send(`${base(hotelId)}/${list}/order`, "PUT", { ids }),
});

export const makeDefaultMethod = (hotelId: string, id: string) =>
  send(`${base(hotelId)}/payment-methods/${id}/default`, "POST");

/** The early check-in and late check-out fees live on the hotel (063). */
export const setEarlyLateFees = (hotelId: string, fees: {
  earlyCheckinCharge?: number | null; lateCheckoutCharge?: number | null;
}) => send(`${base(hotelId)}/front-desk`, "PATCH", fees);

/** A source's commission here (082): null clears it - "not agreed", not 0. */
export const setSourceCommission = (hotelId: string, sourceId: string, commissionPct: number | null) =>
  send(`${base(hotelId)}/booking-sources/${sourceId}/commission`, "PUT", { commissionPct });
