import { api, ApiError } from "@/lib/api";

/* What a company or booking site paid against what it owes on the City
   ledger (the owner's D27-152, D27-239). Plain payments: no GST receipt
   voucher. Append-only: a wrong line is reversed by its own line. */

export interface LedgerAccount {
  companyId: string | null;
  bookingSourceId: string | null;
  name: string;
}

export interface CompanyPayment {
  id: string;
  account: string;
  companyId: string | null;
  bookingSourceId: string | null;
  /** Negative on a reversal. */
  amount: number;
  receivedOn: string;
  method: string;
  reference: string | null;
  note: string | null;
  reversesId: string | null;
  reason: string | null;
  recordedBy: string | null;
  recordedAt: string;
  reversed: boolean;
}

export interface CompanyPaymentsView {
  businessDate: string;
  /** How a company may pay: the server's list (key → words). */
  methods: Record<string, string>;
  accounts: LedgerAccount[];
  payments: CompanyPayment[];
}

export const getCompanyPayments = (hotelId: string) =>
  api<CompanyPaymentsView>(`/api/hotels/${hotelId}/company-payments`);

type Result = { ok: true; id?: string } | { ok: false; reason: string };

async function call(path: string, body: unknown): Promise<Result> {
  try {
    return await api<Result>(path, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}

export const recordCompanyPayment = (hotelId: string, input: {
  companyId: string | null; bookingSourceId: string | null; amount: number;
  receivedOn: string; method: string; reference: string; note: string;
}) => call(`/api/hotels/${hotelId}/company-payments`, {
  ...input,
  companyId: input.companyId ?? undefined,
  bookingSourceId: input.bookingSourceId ?? undefined,
});

export const reverseCompanyPayment = (hotelId: string, id: string, reason: string) =>
  call(`/api/hotels/${hotelId}/company-payments/${id}/reverse`, { reason });
