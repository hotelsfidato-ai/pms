/* Laundry — the front door. Nothing outside this service imports from it
   yet: the menu and the screen addresses are read by the core from
   `nav.ts` and `routes.tsx`, which is the one crossing
   `src/test/boundaries.test.ts` allows.

   When something else does need laundry — a guest's own page sending a
   bag, when its door can carry a request — what it needs is exported
   here and nowhere else. MODULE.md beside this file says what the
   service is and what it still waits on. */
export {};
