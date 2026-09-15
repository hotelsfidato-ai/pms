/* ══════════════════════════════════════════════════════════════════
   LOCAL TEST SIGN-INS — development only

   Shown only when `devAuth` is on (VITE_ALLOW_DEV_AUTH=1, which only the
   local .env sets; .env.production blanks it). Each one signs in through
   the same firebase_uid path a real account uses — only the token check
   is skipped, and the API refuses to start that way in production.

   ONE LIST, TWO USES: the sign-in page's buttons and the account menu's
   "view as" switcher. Two copies of it would be two lists to keep in step.

   Seeded by:
     dev-owner             db/dev/dev-identities.sql (with the test fixtures)
     dev-gm, dev-desk      db/dev/dev-testers.sql    (needs 5EL — load-demo)

   ⚠ AGRA AND PUNE WERE HERE ONCE AND BOTH BUTTONS WERE DEAD. They were
   demo properties, and deleting the demo took their clerks with it —
   the buttons stayed, and pressing either got "No active staff record
   for this account." Only accounts that exist and are ACTIVE belong
   here; a shortcut to an account that is not there is a shortcut to a
   401.
   ══════════════════════════════════════════════════════════════════ */

export interface DevIdentity {
  uid: string;
  label: string;
  detail: string;
}

export const DEV_IDENTITIES: readonly DevIdentity[] = [
  { uid: "dev-owner", label: "Owner", detail: "every property · group admin" },
  { uid: "dev-gm", label: "General Manager", detail: "5 Elements Akkalkot · GM" },
  { uid: "dev-desk", label: "Reception", detail: "5 Elements Akkalkot · front desk" },
];
