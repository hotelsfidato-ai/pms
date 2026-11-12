import type { Mount } from "../../mount.ts";
import { directory } from "./directory.ts";
import { formC } from "./formC.ts";
import { bookingSources } from "./bookingSources.ts";
import { people } from "./people.ts";
import { companions } from "./companions.ts";
import { preferences } from "./preferences.ts";

/* Form III (D27-25): the rule and the savers check-in, walk-in and
   check-out share with the register. */
export {
  formIIIRefusal, identityProblem, isForeign, maskedId, saveCompanionsDeparture,
  saveIdentity, saveVisit, type Identity, type Visit,
} from "./formIII.ts";

/* A guest's preferences (D27-383 item 10): the one rule, for the guest's page's door. */
export { cleanPreferences, type Preferences } from "./preferenceRules.ts";
/* The in-house guest's allergy, for the KOT and the Kitchen screen (D27-396). */
export { inHouseAllergies } from "./preferences.ts";

/* The front door of the guests and companies service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts). */
export const mounts: readonly Mount[] = [
  ["/api/hotels", directory],
  ["/api/hotels", formC],
  ["/api/hotels", bookingSources],
  /* One guest, one record - the Central CRM, phase 1 (people.ts). */
  ["/api/hotels", people],
  /* Every adult in a room (D27-382). */
  ["/api/hotels", companions],
  /* A guest's preferences (D27-383 item 10). */
  ["/api/hotels", preferences],
];
