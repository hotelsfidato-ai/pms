import type { Mount } from "../../mount.ts";
import { folios } from "./folios.ts";
import { postings } from "./postings.ts";
import { cashier } from "./cashier.ts";
import { billing } from "../../routes/billing.ts";
import { invoices } from "../../routes/invoices.ts";

/* The front door of the finance service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", folios],
  ["/api/hotels", postings],
  ["/api/hotels", cashier],
  ["/api/hotels", billing],
  ["/api/hotels", invoices],
];
