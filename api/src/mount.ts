import type { Hono } from "hono";

/* ══════════════════════════════════════════════════════════════════
   WHERE A SERVICE'S ROUTES ARE MOUNTED (docs/SERVICE-FOLDERS-PLAN.md)

   Each service's front door, `api/src/modules/<service>/index.ts`, lists
   its routers and the prefix each hangs from; `server.ts` mounts every
   service in turn. Three prefixes exist and each means something:

     /api/hotels   a person's routes, scoped to a property by its code
     /api          administration — creating a property is not scoped to one
     /api/pos      an outside till, which presents an outlet key, not a token
     /api/channel  the channel manager's door, which SU pushes bookings to
                   with the key the owner gave it (D17-79)
     /api/guest    a guest's own page, opened by a link the hotel gave them
                   and nothing else (D18-9)

   The auth gate in server.ts covers all four by prefix, so a router
   mounted here is authenticated by existing rather than by remembering.

   ⚠ TWO PREFIXES LEAVE THE GATE WITHOUT A PERSON, and no more.
   `/api/channel`: SU has no sign-in and is not staff, so the door checks SU's
   key itself and opens its session as that hotel's own service account.
   `/api/guest`: a guest has no sign-in either, and never will - their door
   takes a link, hashes it, and asks migration 114's functions about the ONE
   booking that link names. It opens no session at all.
   Nothing else may be mounted at either. `api/test/apiGate.test.ts` holds each
   to one router, and holds the exemption to a path boundary.
   ══════════════════════════════════════════════════════════════════ */

// Routers carry their own Variables types; the mount only needs a router.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Mount = readonly [
  prefix: "/api" | "/api/hotels" | "/api/pos" | "/api/channel" | "/api/guest",
  router: Hono<any, any, any>,
];
