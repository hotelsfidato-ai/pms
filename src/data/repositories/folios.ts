import * as ops from "./operations";
import * as stays from "./stays";

/* Object surface over ./operations and ./stays. A shim, not a second
   implementation — the append-only ledger lives in src/data/store.ts. */

export const foliosRepo = {
  get: stays.getFolio,
  listOpen: stays.listOpenFolios,
  postings: ops.getFolioPostings,
  balance: ops.getFolioBalance,
  addPosting: ops.postCharge,
  reversePosting: ops.reverseCharge,
  canReverse: ops.reverseChargeAllowed,
  settle: ops.settle,
  getBalance: ops.getFolioBalance,
};

export const folioRepo = foliosRepo;
