import type { Mount } from "../../mount.ts";
import { contracts } from "./contracts.ts";
import { allotments } from "./allotments.ts";

/* The front door of Contracts on the server - the only file the core or
   another service may import (src/test/boundaries.test.ts).

   D27-178, D27-184: a company's record (add, edit), its contract per hotel,
   and the price a party pays under it. The booking itself is priced by
   reservations/book.ts through the same database function
   (app.contract_price), never a copy of it here. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", contracts],
  /* Allotments (D27-383 item 8, 267): rooms held under a contract. */
  ["/api/hotels", allotments],
];

/* A booking made against an allotment is checked here, inside the
   booking's own transaction (reservations/book.ts). */
export { allotmentPickup } from "./allotments.ts";
