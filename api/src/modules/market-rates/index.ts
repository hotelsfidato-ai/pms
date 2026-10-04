import type { Mount } from "../../mount.ts";
import { marketRates } from "./routes.ts";

/* The front door of Market rates on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   Rivals' prices (D27-270): each nearby hotel's lowest public price per
   night, checked twice a week through SerpApi, read beside revenue
   management's suggestions. Revenue management reads it through the GET
   below and nothing else. `jobs` is the check's timer, started by server.ts. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", marketRates],
];

export { jobs } from "./sweep.ts";
