import { property, PROPERTY_ID } from "../fixtures/property";
import type { Property } from "./types";

/* ══════════════════════════════════════════════════════════════════
   PROPERTIES

   Stage 1 runs on one property. Every signature is written as though
   there were seven, because there will be — and because the database
   underneath is already multi-tenant with `hotel_id` on 13 tables.

   Never `properties[0]`. Never a hardcoded id. Never a branch on
   `length === 1`.
   ══════════════════════════════════════════════════════════════════ */

const KNOWN: Property[] = [
  {
    id: property.id,
    name: property.name,
    address: property.address,
    phone: property.phone,
    email: property.email,
    gstin: property.gstin,
    currency: property.currency,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    rooms: property.rooms,
    roomTypes: property.roomTypes,
    rateTypes: property.rateTypes,
    tax: property.tax,
    paymentMethods: property.paymentMethods,
  },
];

/** Every property the signed-in user may see. */
export async function listProperties(): Promise<Property[]> {
  return KNOWN;
}

export async function getProperty(hotelId: string): Promise<Property | null> {
  return KNOWN.find((p) => p.id === hotelId) ?? null;
}

/** The property to land on when none is named in the URL. */
export async function defaultPropertyId(): Promise<string> {
  return PROPERTY_ID;
}

/* Room queries live in ./rooms — one home each, so `export *` from the
   seam index cannot become ambiguous. */
