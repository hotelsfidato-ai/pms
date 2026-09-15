import type { Hono } from "hono";

/* ══════════════════════════════════════════════════════════════════
   WHERE A SERVICE'S ROUTES ARE MOUNTED (docs/SERVICE-FOLDERS-PLAN.md)

   Each service's front door, `api/src/modules/<service>/index.ts`, lists
   its routers and the prefix each hangs from; `server.ts` mounts every
   service in turn. Three prefixes exist and each means something:

     /api/hotels   a person's routes, scoped to a property by its code
     /api          administration — creating a property is not scoped to one
     /api/pos      an outside till, which presents an outlet key, not a token

   The auth gate in server.ts covers all three by prefix, so a router
   mounted here is authenticated by existing rather than by remembering.
   ══════════════════════════════════════════════════════════════════ */

// Routers carry their own Variables types; the mount only needs a router.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Mount = readonly [prefix: "/api" | "/api/hotels" | "/api/pos", router: Hono<any, any, any>];
