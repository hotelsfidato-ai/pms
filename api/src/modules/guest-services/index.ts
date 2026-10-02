import type { Mount } from "../../mount.ts";
import { requests } from "./requests.ts";
import { wakeAndLost } from "./wakeAndLost.ts";

/* The front door of guest services on the server - the only file the core
   or another service may import (src/test/boundaries.test.ts). In-stay
   requests (D27-178, D27-181); `teamsFor` tells the bell whose they are. */
export { teamsFor } from "./requests.ts";

export const mounts: readonly Mount[] = [
  ["/api/hotels", requests],
  /* Wake-up calls and lost property (D27-239, D27-241). */
  ["/api/hotels", wakeAndLost],
];
