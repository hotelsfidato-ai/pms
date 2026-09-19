/* Reviews — BUILT, 19 September (D18-14): its screen (`pages/Reviews.tsx`),
   its menu entry (`nav.ts`) and its address (`routes.tsx`).

   No other service uses anything from here, so this front door still exports
   nothing - and that is the right answer rather than an unfinished one.
   Reviews READS from other services (the departures are reservations, the
   send is the shared door at `api/src/sending.ts`); nothing reads from it.
   The day something needs to - a guest's card showing whether they were ever
   asked - it is exported HERE and nowhere else (src/test/boundaries.test.ts).

   What the service is, and what it still waits on, is in MODULE.md beside
   this file. */
export {};
