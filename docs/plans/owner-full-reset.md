# A full reset button, for the owner's account only — plan (D27-342, 17 October)

**Status: plan only.** The owner: "plan how to reset all the data … an option to do a
full reset which is only for my ID (influvateseo@gmail.com) … but this is a future
plan." Nothing here is built. Today a reset is `api/scripts/reset-property.ts`, typed on
the server (D27-298 on 10 Oct; Amrapali again on 17 Oct).

## What it would be

A **Clear this hotel and start today** button on Admin → Properties, on each real hotel.

1. **Who.** Only the person signed in with the e-mail `influvateseo@gmail.com`. The
   server checks it on every call; hiding the button is not the guard. No role gives it,
   not the owner role, not an administrator. The address lives in the server's settings
   (`api/.env`, a new `RESET_OWNER_EMAIL`), not in the code.
2. **First, the count.** The button opens a window with what would go: bookings,
   guests, bills, invoices, restaurant orders, and so on. These are the dry run's numbers,
   from `reset-property.ts`'s own lists (`CLEAR`, `FRESH`), so the button and the script
   cannot differ.
3. **Then, the confirmation.** Type the hotel's code (for example `AMR`) to enable
   **Clear and start today**.
4. **Then, a backup.** A fresh database backup is taken automatically before anything is
   removed (the server's `fidato-backup`), and its file name is shown.
5. **Then, the clear.** It runs as `--fresh-start` does today, in one transaction (all or
   nothing). Every booking, guest, bill, payment, invoice, order, banquet, night audit,
   cash shift and stock movement goes. The hotel, rooms, rates, menu, tables, staff,
   sign-ins and settings stay. The business date becomes today. Invoice numbers carry on
   and are never reused.
6. **A record.** One line in the audit trail: who, when, which hotel, how many rows went,
   and the backup's name.

## Built how (when it is built)

- `reset-property.ts`'s clearing moves into a function both the script and a new route
  call. That keeps one list, and `resetOrder.test.ts` still checks it against the schema.
- The route runs as a role that may lift the append-only guards. The API's own role
  cannot, so the route needs a separate, narrowly-scoped database connection. Plan that
  carefully: it is the most powerful thing the API would ever do.
- Tests:
  - refused for every account but that e-mail, including the owner and administrator roles;
  - refused without the typed code;
  - rolls back whole on a failure;
  - the business date is today afterwards;
  - the invoice series continues.

## Questions for the owner before it is built

1. One hotel at a time only, or also "every hotel at once"? (Recommended: one at a time.)
2. Refuse while guests are checked in? (Recommended: yes. Check them out first, or say
   why not.)
3. Should the backup also be copied off the server first? (Off-site backups are planned
   for a later version.)
4. Leave the test hotels' own **Reset** as it is? (Recommended: yes.)

Rough size: about a day, with its tests and the manual's page.
