/* What the Waiter and the Bar may do in the restaurant, which the matrix
   cannot show (POS-35, the owner's D27-329 (4)): the restaurant has no
   resource of its own, so the server lets them in BY NAME
   (api/src/roleGate.ts, TILL, KOT_PRINT, TABLE_ANSWER, DAY_END and their
   reads). The server's own words. api/test/modules/pos/barRole.test.ts
   fails if this differs from every rule that names `pos` or `bar`. */
export const RESTAURANT_BY_NAME = {
  does: [
    "Ringing up an order",
    "Printing the kitchen's KOTs",
    "Answering a table booking",
    "Closing the restaurant's day",
  ],
  reads: [
    "the restaurant's orders",
    "the menu",
    "the kitchen's KOTs",
    "the restaurant's outlets",
    "the restaurant's day",
  ],
} as const;
