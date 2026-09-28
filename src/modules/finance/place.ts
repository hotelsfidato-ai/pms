/* THE SUPPLIER'S PLACE, ONCE (the tax invoice's rule, 27 September; shared
   28 September for the VAT bill's footer and the interim bill, which
   printed "…Maharashtra 413216, Akkalkot, MH" - QA FI-16 and the print
   samples). An address that already names its city is complete, so nothing
   is appended to it; the state column holds a code the address spells out. */

/** The city and state to print after an address, or null when it names them. */
export function placeAfter(address: string | null, city: string | null, state: string | null): string | null {
  if (city && (address ?? "").toLowerCase().includes(city.toLowerCase())) return null;
  const parts = [city, state].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The address and its place on one line, the place once. */
export const placeLine = (address: string | null, city: string | null, state: string | null): string =>
  [address, placeAfter(address, city, state)].filter(Boolean).join(", ");
