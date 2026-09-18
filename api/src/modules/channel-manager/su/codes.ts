/* ══════════════════════════════════════════════════════════════════
   SU's OWN LISTS — room types, meal plans, and its endpoints

   Copied from SU's "Codes" pages (read 17 September 2026). A person picks
   from these on the channel manager screen; nothing maps a PMS room type or
   meal plan to one of them on its own, because "Continental Plan" could be
   SU's 9 Continental breakfast or its 2 Breakfast, and which one a booking
   site shows a guest is the hotel's to say.

   A value SU does not list is refused before it is ever sent.
   ══════════════════════════════════════════════════════════════════ */

export const SU_ROOM_TYPES: ReadonlyArray<readonly [code: number, name: string]> = [
  [1, "Apartment"], [4, "Quadruple"], [5, "Suite"], [7, "Triple"], [8, "Twin"],
  [9, "Double"], [10, "Single"], [12, "Studio"], [13, "Family"],
  [25, "Dormitory room"], [26, "Bed in Dormitory"], [27, "Bungalow"],
  [28, "Chalet"], [29, "Holiday home"], [31, "Villa"], [32, "Mobile home"],
  [33, "Tent"], [34, "Powered/Unpowered Site"], [35, "King"], [36, "Queen"],
];

export const SU_MEAL_PLANS: ReadonlyArray<readonly [code: number, name: string]> = [
  [1, "All inclusive"], [2, "Breakfast"], [3, "Lunch"], [4, "Dinner"],
  [5, "American"], [6, "Bed & breakfast"], [7, "Buffet breakfast"],
  [8, "Caribbean breakfast"], [9, "Continental breakfast"],
  [10, "English breakfast"], [11, "European plan"], [12, "Family plan"],
  [13, "Full board"], [14, "Half board/modified American plan"],
  [15, "Room only"], [16, "Self catering"], [17, "Bermuda"],
  [18, "Dinner bed and breakfast plan"], [19, "Family American"],
  [20, "Modified"], [21, "Breakfast & lunch"], [22, "Full breakfast"],
];

export const isSuRoomType = (code: number) => SU_ROOM_TYPES.some(([c]) => c === code);
export const isSuMealPlan = (code: number) => SU_MEAL_PLANS.some(([c]) => c === code);

/** SU's ids: letters, digits and hyphens, at most 20 (hotelid, roomid, rateplanid). */
export const SU_ID = /^[A-Za-z0-9-]{1,20}$/;

/* The endpoints, as SU's documents give them, after the host. */
export const SU_ENDPOINTS = {
  property: "/SUAPI/jservice/OTA_HotelDescriptiveContentNotif",
  roomType: "/SUAPI/jservice/OTA_HotelRoom",
  ratePlan: "/SUAPI/jservice/OTA_HotelRatePlan",
  availability: "/SUAPI/jservice/availability",
  reservations: "/SUAPI/jservice/Reservation",
  reservationsReceived: "/SUAPI/jservice/Reservation_notif",
} as const;
