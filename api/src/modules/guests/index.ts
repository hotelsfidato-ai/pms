import type { Mount } from "../../mount.ts";
import { directory } from "./directory.ts";
import { formC } from "./formC.ts";
import { bookingSources } from "./bookingSources.ts";
import { people } from "./people.ts";

/* The front door of the guests and companies service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", directory],
  ["/api/hotels", formC],
  ["/api/hotels", bookingSources],
  /* One guest, one record - the Central CRM, phase 1 (people.ts). */
  ["/api/hotels", people],
];
