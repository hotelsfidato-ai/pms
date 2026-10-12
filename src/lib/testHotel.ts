import { useMemo } from "react";
import { useSession } from "./session";
import { useUi } from "./ui";
import type { ApiHotel } from "./api";

/* ══════════════════════════════════════════════════════════════════
   TEST HOTELS (the owner's D27-296, 10 October)

   A test hotel is a practice copy of a real hotel, inside the live
   system: "Hotel Amrapali · TEST". The server says which hotels are test
   ones: `testOf` on GET /api/hotels names the real hotel's CODE, and is
   null for a real hotel. Nothing here guesses from a name.

   What the screens do with it, each said where it is done:
     the orange stripe on every screen         components/app/TestHotel.tsx
     TEST beside its name in every hotel list  TestTag, hotelLabel below
     TEST · NOT VALID on every document        TestDocumentMark, no GSTIN
     sending buttons off, with the sentence    NOTHING_SENT
     left out of everything real               useRealHotels below

   The words are here once, so a screen and its test read the same line.
   ══════════════════════════════════════════════════════════════════ */

/** On every screen of a test hotel, exactly (D27-296 (9)). */
export const TEST_STRIPE = "TEST HOTEL · practice only · nothing here is real";
/** Across every document a test hotel prints (D27-296 (8)). */
export const TEST_DOCUMENT = "TEST · NOT VALID";
/** Under every sending button in a test hotel; the server answers a send
    with the same sentence (409). */
export const NOTHING_SENT = "This is a test hotel: nothing is sent from it.";

export const isTestHotel = (hotel: Pick<ApiHotel, "testOf"> | null | undefined): boolean =>
  Boolean(hotel?.testOf);

/** A test hotel's name without a " · TEST" the server may already end it
    with: the lists put their own TEST beside it, and "TEST TEST" is noise. */
export const plainName = (hotel: Pick<ApiHotel, "name" | "testOf">): string =>
  isTestHotel(hotel) ? hotel.name.replace(/\s*·\s*TEST\s*$/i, "") : hotel.name;

/** A hotel's name where only text can go (a select's option): "<name> · TEST"
    for a test hotel, the name as it is for a real one. */
export const hotelLabel = (hotel: Pick<ApiHotel, "name" | "testOf">): string =>
  isTestHotel(hotel) ? `${plainName(hotel)} · TEST` : hotel.name;

/**
 * Is this hotel a test hotel? By its code or its id; without either, the
 * hotel IN VIEW - the code in the address, as every screen reads it.
 * False until the session knows the hotel (a guest's own page has no
 * session at all): only a hotel the server named a test hotel is one.
 */
export function useIsTestHotel(code?: string | null): boolean {
  const inView = useUi((s) => s.hotelId);
  const at = code || inView;
  return useSession((s) => isTestHotel(s.hotels.find((h) => h.code === at || h.id === at)));
}

/** The codes of the test hotels this person can see. */
export function useTestCodes(): Set<string> {
  const hotels = useSession((s) => s.hotels);
  return useMemo(() => new Set(hotels.filter(isTestHotel).map((h) => h.code)), [hotels]);
}

/** The real hotels only: a group view leaves the test ones out (D27-296 (11)). */
export function useRealHotels(): ApiHotel[] {
  const hotels = useSession((s) => s.hotels);
  return useMemo(() => hotels.filter((h) => !isTestHotel(h)), [hotels]);
}
