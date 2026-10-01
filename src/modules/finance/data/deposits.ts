import { api, ApiError, apiBase, authHeaders } from "@/lib/api";

/* Cash deposits (the owner's D27-190, D27-191): each closed day's cash to
   deposit per cash point, the deposits recorded against it, and who
   verified them. The server decides who may do what; `canRecord` and
   `canVerify` say so for the screen. */

export interface DepositDay {
  date: string;
  /** Per cash point. Null where a close kept no figure: unknown, not zero. */
  points: { point: string; amount: number | null }[];
  toDeposit: number | null;
  deposited: number;
  difference: number | null;
  explanation: { reason: string; by: string | null; at: string } | null;
  /** A difference nobody has explained since the day's last entry. */
  red: boolean;
}

export interface Deposit {
  id: string;
  businessDate: string;
  amount: number;
  depositedOn: string | null;
  bank: string | null;
  slipNo: string | null;
  /** Set on a reversal: the line it takes back. */
  reversesId: string | null;
  reason: string | null;
  recordedBy: string | null;
  recordedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  reversed: boolean;
  /** The latest photo of the bank's slip, if any. */
  slipId: string | null;
}

export interface CashDeposits {
  businessDate: string;
  canRecord: boolean;
  canVerify: boolean;
  days: DepositDay[];
  deposits: Deposit[];
}

export async function getCashDeposits(hotelId: string): Promise<CashDeposits> {
  return api<CashDeposits>(`/api/hotels/${hotelId}/cash-deposits`);
}

type Result = { ok: true; id?: string } | { ok: false; reason: string };

async function call(path: string, body: unknown): Promise<Result> {
  try {
    return await api<Result>(path, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const recordDeposit = (hotelId: string, input: {
  businessDate: string; amount: number; depositedOn: string; bank: string; slipNo: string;
}) => call(`/api/hotels/${hotelId}/cash-deposits`, input);

export const reverseDeposit = (hotelId: string, id: string, reason: string) =>
  call(`/api/hotels/${hotelId}/cash-deposits/${id}/reverse`, { reason });

export const verifyDeposit = (hotelId: string, id: string) =>
  call(`/api/hotels/${hotelId}/cash-deposits/${id}/verify`, {});

export const explainDay = (hotelId: string, date: string, reason: string) =>
  call(`/api/hotels/${hotelId}/cash-deposits/days/${date}/explain`, { reason });

/**
 * The slip's photo, through the shared attachments route. NOT through `api()`:
 * it always sends JSON, and a photo cannot be held offline to send later.
 */
export async function attachSlip(hotelId: string, depositId: string, file: File): Promise<Result> {
  const form = new FormData();
  form.set("table", "cash_deposits");
  form.set("id", depositId);
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

/** The slip's photo, fetched with the person's own sign-in, as an address this browser alone can open. */
export async function slipAddress(hotelId: string, attachmentId: string): Promise<Result & { url?: string }> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const res = await fetch(`${await apiBase()}/api/hotels/${hotelId}/attachments/${attachmentId}/file`, { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, reason: body?.error ?? "The photo could not be opened." };
    }
    return { ok: true, url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { ok: false, reason: "The photo needs the connection to open." };
  }
}
