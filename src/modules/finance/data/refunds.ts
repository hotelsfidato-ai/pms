import { api, ApiError } from "@/lib/api";
import type { OperationResult } from "@/data/repositories/result";
import { refuse } from "@/data/repositories/result";

/* A REFUND (the owner's D27-315 Part B): what may be given back on a
   stay's bills, giving it, and its receipt. The server decides every rule;
   these only carry them (api/src/modules/finance/refunds.ts). */

export interface RefundWay { label: string; kind: string; upTo: number }
export interface RefundBill {
  folioId: string;
  credit: number;
  /** Why this bill's credit is not refunded here (a company's, a booking site's). */
  notice: string | null;
  ways: RefundWay[];
}
export interface RefundOptions { may: boolean; ceiling: number; bills: RefundBill[] }

export const getRefundOptions = (hotelId: string, stayId: string) =>
  api<RefundOptions>(`/api/hotels/${hotelId}/stays/${stayId}/refunds`);

export interface RefundInput {
  folioId: string; method: string; amount: number; reference: string; reason: string;
}

export async function giveRefund(
  hotelId: string, stayId: string, input: RefundInput, idempotencyKey: string,
): Promise<OperationResult<{ id: string }>> {
  try {
    const res = await api<{ data: { id: string } }>(`/api/hotels/${hotelId}/stays/${stayId}/refunds`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idempotencyKey },
    });
    return { ok: true, data: res.data };
  } catch (error) {
    if (error instanceof ApiError) return refuse(error.message);
    throw error;
  }
}

export interface RefundReceipt {
  number: string; date: string; at: string; amount: number;
  method: string; reference: string | null; reason: string; givenBy: string | null;
  guest: string; booking: string; room: string | null; takenBack: boolean;
  hotel: { name: string; address: string | null; city: string | null; state: string | null;
           phone: string | null; gstin: string | null };
}

export const getRefundReceipt = (hotelId: string, stayId: string, postingId: string) =>
  api<RefundReceipt>(`/api/hotels/${hotelId}/stays/${stayId}/refunds/${postingId}`);
