/* Spa — the front door of this service on the website: the only file
   another service may import (src/test/boundaries.test.ts).

   BUILT, 19 September. The screens are `pages/SpaDiary.tsx` and
   `pages/SpaSetup.tsx`, their menu entries are `nav.ts` and their
   addresses are `routes.tsx`; the Coming soon page is gone, because a
   service that is built cannot also be coming soon.

   Nothing else needs anything from the spa yet, so this door still
   exports nothing. The day a folio line wants to name the treatment it
   came from, it is added HERE and not reached for inside `pages/` or
   `data/`. What the service is, and what it is still waiting on, is in
   MODULE.md beside this file. */
export {};
