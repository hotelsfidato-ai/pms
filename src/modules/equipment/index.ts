/* Equipment — the register of durable things in the hotel, the restaurant
   and the rooms (phase 1B, built 16 September). Its screens are
   `pages/EquipmentRegister.tsx` and `pages/EquipmentItem.tsx`, its menu entry
   `nav.ts`, its addresses `routes.tsx`.

   No other service uses anything from here yet, so this front door exports
   nothing. Housekeeping's repairs (phase 2B) will point a work order at an
   item; what it needs from here is written in MODULE.md under "Requests"
   when it asks. */
export {};
