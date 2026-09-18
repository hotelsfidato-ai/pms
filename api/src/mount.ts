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

   The auth gate in server.ts covers all four by prefix, so a router
   mounted here is authenticated by existing rather than by remembering.

   ⚠ `/api/channel` IS THE ONE PREFIX THAT LEAVES THE GATE WITHOUT A PERSON.
   SU has no sign-in and is not a member of staff: the door checks SU's key
   itself, works out whose booking it is from the id SU was given, and opens
   its session as that hotel's own service account. Nothing else may be
   mounted there. `api/test/apiGate.test.ts` holds that to one router.
   ══════════════════════════════════════════════════════════════════ */

// Routers carry their own Variables types; the mount only needs a router.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Mount = readonly [prefix: "/api" | "/api/hotels" | "/api/pos" | "/api/channel", router: Hono<any, any, any>];
