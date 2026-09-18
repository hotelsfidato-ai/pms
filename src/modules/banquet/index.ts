/* The front door of the Banquet service — the only file another service
   may import (src/test/boundaries.test.ts). See MODULE.md. */

/* For the till (D17-21, 17 September): the functions a restaurant order
   may be attached to right now. The rule lives on the server, which also
   refuses an attachment outside it — do not filter this list again. */
export {
  getAttachableFunctions,
  type AttachableFunction,
  type AttachableFunctions,
} from "@/modules/banquet/data/banquet";
