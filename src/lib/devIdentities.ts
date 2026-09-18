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
  /* ONE PER ROLE, for the owner's QA (18 September). Every screen is meant to
     be read by somebody, and a menu is only proved by the person who has it:
     the housekeeper who sees no revenue, the Inventory Manager who sees the
     store and nothing else, the accountant who sees the money.

     They resolve exactly as the three above do - a staff row rostered at 5EL,
     with the role deciding everything - and they exist only where
     `db/dev/dev-testers.sql` has been run. Stripped from a production build
     with the rest of the development sign-in. */
  { uid: "dev-admin", label: "Admin", detail: "every property · administrator" },
  { uid: "dev-hotel-manager", label: "Hotel Manager", detail: "5 Elements Akkalkot" },
  { uid: "dev-revenue", label: "Revenue Manager", detail: "5 Elements Akkalkot · rates" },
  { uid: "dev-housekeeping", label: "Housekeeping", detail: "5 Elements Akkalkot · rooms" },
  { uid: "dev-stores", label: "Inventory Manager", detail: "5 Elements Akkalkot · store" },
  { uid: "dev-kitchen", label: "Kitchen Manager", detail: "5 Elements Akkalkot · the pass" },
  { uid: "dev-chef", label: "Chef", detail: "5 Elements Akkalkot · the pass" },
  { uid: "dev-finance", label: "Accountant", detail: "5 Elements Akkalkot · money" },
];
