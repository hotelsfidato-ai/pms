import { api, ApiError } from "@/lib/api";

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
  billTo: string;
  company: string | null;
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
  };
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
