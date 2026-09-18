import type { Mount } from "../../mount.ts";
import { stays } from "./stays.ts";
import { operations } from "./operations.ts";
import { stayExtras } from "./stayExtras.ts";

/* The front door of the front desk service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", stays],
  ["/api/hotels", operations],
  ["/api/hotels", stayExtras],
];
