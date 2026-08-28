import * as stays from "./stays";

/* ══════════════════════════════════════════════════════════════════
   RESERVATIONS — object surface over ./stays

   A thin shim, not a second implementation. Callers written against
   `reservationsRepo` resolve here; the logic lives in ./stays and
   there is only ever one copy of it.

   It exports exactly one name, so `export *` from the seam index can
   never collide with the named functions ./stays provides.
   ══════════════════════════════════════════════════════════════════ */

export const reservationsRepo = {
  list: stays.listStays,
  get: stays.getStay,
  listArrivals: stays.listArrivals,
  listInHouse: stays.listInHouse,
  listDepartures: stays.listDepartures,
  listGroups: stays.listGroups,
  listGroupMembers: stays.listGroupMembers,
};

export const reservationRepo = reservationsRepo;
