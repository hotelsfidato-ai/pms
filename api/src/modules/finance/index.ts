import type { Mount } from "../../mount.ts";
import { folios } from "../../routes/folios.ts";
import { billing } from "../../routes/billing.ts";
import { invoices } from "../../routes/invoices.ts";
import { tax } from "./tax.ts";

/* The front door of the finance service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", folios],
  ["/api/hotels", billing],
  ["/api/hotels", invoices],
  ["/api/hotels", tax],
];
