/* The front door of Connection health - the only file another service may
   import (src/test/boundaries.test.ts).

   D27-276 (point 3): every outside connection green, amber, red or grey,
   with its last success and last error. Nobody else uses it yet; its page
   registers itself in the Settings console (health.settings.ts), not here. */
export type { Connection, ConnectionsHealth, ConnectionStatus } from "./data";
