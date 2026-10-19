import { api, ApiError } from "@/lib/api";
import type { InvoiceDetail } from "./billing";

/* THE BILL AS IT STANDS (D21-10) — what the desk prints and the guest's page
   shows. ONE definition, on the server: `app.stay_bill` (migration 123). This
   file only fetches it; nothing here adds, taxes or rounds a figure, because a
   second copy of that arithmetic is how a page and a printout come to
   disagree at check-out. */

export interface StayBillLine {
  date: string;
  description: string;
  category: string;
  amount: number;
  tax: number;
  /** The line's own GST rate, or null when it carries none. */
  rate: number | null;
  /** gst or vat (166); absent from an older server, read as GST. */
  scheme?: "gst" | "vat";
  /** Where the line came from, through a correction (175, D27-223). */
  source?: string | null;
  billTo: string;
  company: string | null;
  /** Its kind's SAC (D27-344); null: a dash. The desk's bill only. */
  sac?: string | null;
}

export interface StayBill {
  hotel: {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    phone: string | null;
    /** Null when the hotel has not set one — printed as a dash, never made up. */
    gstin: string | null;
    /** The desk's bill only (D27-344): how to reach the hotel, its PAN and FSSAI number. */
    email?: string | null; website?: string | null; pan?: string | null; fssai?: string | null;
  };
  /** The stay as the tax invoice shows it (D27-344); the desk's bill only. */
  details?: InvoiceDetail["stay"];
  /** Money received on the stay's bills (D27-344); the desk's bill only. */
  payments?: InvoiceDetail["payments"];
  stay: {
    reference: string;
    guest: string;
    checkIn: string;
    checkOut: string;
    room: string | null;
  };
  lines: StayBillLine[];
  /** One row per GST rate on the bill; CGST and SGST are each half of it. */
  taxes: { rate: number; taxable: number; cgst: number; sgst: number }[];
  /** One row per VAT rate - alcohol (D21-91). Never halved. `tax` and the
      totals below include it: it is tax the guest pays. */
  vat: { rate: number; taxable: number; vat: number }[];
  net: number;
  tax: number;
  total: number;
  rounded: number;
  roundOff: number;
  paid: number;
  balance: number;
  /** Tonight's room night, not posted yet (D27-204): a guest staying on,
      before tonight's audit. The audit's own answer - its words, the rate
      before GST, the GST and its rate. Absent when tonight is posted, the
      room is complimentary or the guest leaves today; the desk's bill only. */
  tonight?: { description: string; amount: number; tax: number; rate: number };
  /** The stay's nights still to come on this bill, counted by the night
      audit's own rule on the server (FIN-24, 1 October): not a night on the
      group's master, not a night somebody reversed. The desk's bill only. */
  nightsToCome?: number;
}

/** The stay's bill, or null for a stay this person may not see. */
export async function getStayBill(hotelId: string, stayId: string): Promise<StayBill | null> {
  if (!hotelId || !stayId) return null;
  try {
    return await api<StayBill>(`/api/hotels/${hotelId}/stays/${stayId}/bill`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
