/* ══════════════════════════════════════════════════════════════════
   WHO SEES THE SU SETUP — D17-85

   The owner, 17 September: "the owner AND an administrator" set the SU
   connection up; a general manager sees the status page and no more. A
   group administrator counts as the owner everywhere (`roleFor`).

   ⚠ A COPY of `api/src/modules/channel-manager/access.ts` (SU_ROLES),
   because the screen and the server must refuse the same people and
   neither imports the other. `api/test/modules/channel-manager/suLogin.test.ts`
   compares the two lists and fails if they differ.

   It is not `can(role, "edit", "integration")` because that grant is still
   the owner's alone in `src/lib/permissions.ts`, which is the master's
   file: widening it there is asked for in MODULE.md, and this list moves
   with it when it lands.
   ══════════════════════════════════════════════════════════════════ */

/* Typed as plain text, not as `Role`, on purpose: the API's test imports this
   file to compare the two lists, and it cannot resolve the website's `@`
   alias. The page passes a Role, which is one of these words. */
export const SU_SETUP_ROLES: readonly string[] = ["owner", "admin"];

export const setsUpSu = (role: string): boolean => SU_SETUP_ROLES.includes(role);
