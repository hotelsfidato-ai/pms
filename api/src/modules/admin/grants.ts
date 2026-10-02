import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY READ THE AUDIT LOG AND SETTINGS — on the server

   API-2, the owner's decision of 17 September (D17-15): the server
   refuses what the screen refuses, for every role without the grant.
   Until then `GET /:code/audit-log` and `GET /:code/settings` asked
   nothing — the 16 September route audit had reception read 28 KB of
   audit log while both screens told the same clerk "This page is not
   part of your role". A hidden screen is still a URL (MEMORY 250, 263).

   THE SCREEN'S RULE, copied exactly: `RequireAccess` asks `mayReach`,
   which asks `canAccess(role, resource)` — ANY grant on the resource
   opens the page. So a role is in a list here when it holds any action
   on `audit_log` or `setting` in `src/lib/permissions.ts`.

   ⚠ THESE LISTS ARE A COPY of that matrix. The server does not import
   the website's code, so the two are held together by
   `api/test/modules/admin/grants.test.ts`, which fails the moment they
   differ. Who may do what is the owner's, changed in permissions.ts by
   the master — and changed here in the same merge.

   The role is read the way the website reads it (`roleFor`): a group
   administrator counts as the owner everywhere; anybody else has the
   role their `staff_hotels` row gives them AT THIS HOTEL, and no other.
   ══════════════════════════════════════════════════════════════════ */

export type AdminRead = "audit_log" | "setting";

export const ADMIN_READ_ROLES: Readonly<Record<AdminRead, readonly string[]>> = {
  audit_log: ["owner", "admin", "gm"],
  /* The GM since D17-36 (17 September): "the GM may open Settings". The
     grant itself is the master's, in permissions.ts; this copy moves with
     it, and grants.test.ts fails until both say the same. */
  setting: ["owner", "admin", "gm"],
};

/* Rule 6: say who CAN, so the person knows whom to ask. */
export const ADMIN_READ_REFUSED: Readonly<Record<AdminRead, string>> = {
  audit_log:
    "The audit log is open to the owner, an administrator and the general "
    + "manager. Ask one of them.",
  setting:
    "Settings are open to the owner, an administrator and the general "
    + "manager. Ask one of them.",
};

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SWITCH A MODULE ON OR OFF — D17-36

   "The GM may open Settings; the module switches stay owner and admin
   only." Until 17 September the switch route asked `app.manages_hotel`
   (084) — a group administrator, or `owner`/`gm` at this hotel — which
   let the GM switch and refused the administrator: the decision's two
   roles, the wrong way round.

   ⚠ A COPY of `MODULE_SWITCH_ROLES` in
   `src/modules/admin/moduleSwitchRoles.ts`, which decides whether the
   Settings screen shows the switches at all.
   `api/test/modules/admin/moduleSwitches.test.ts` fails if they differ.
   ══════════════════════════════════════════════════════════════════ */

export const MODULE_SWITCH_ROLES: readonly string[] = ["owner", "admin"];

export const MODULE_SWITCH_REFUSED =
  "Switching a module on or off is for the owner or an administrator. "
  + "Ask one of them.";

/** Does the signed-in person hold one of these roles at this hotel? A
    group administrator counts as the owner, and so holds every list that
    names the owner. */
async function holdsRoleHere(
  client: Client, hotelId: string, roles: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select ('owner' = any($2::text[]) and exists (
              select 1 from staff s
               where s.id = app.current_user_id() and s.is_active and s.is_group_admin
            ))
         or exists (
              select 1 from staff_hotels sh
                join staff s on s.id = sh.staff_id
               where sh.staff_id = app.current_user_id()
                 and sh.hotel_id = $1
                 and s.is_active
                 and sh.role = any($2::text[])
            ) as may`,
    [hotelId, roles],
  );
  return rows[0]?.may === true;
}

/** May the signed-in person read this at this hotel? */
export const mayRead = (client: Client, hotelId: string, what: AdminRead) =>
  holdsRoleHere(client, hotelId, ADMIN_READ_ROLES[what]);

/* D27-245 (Q-A): changes that belong to no single hotel - a guest record, a
   person, a company, the group's settings - are the owner's and an Admin's,
   under "Across the group". Never the GM's: they would show other hotels' work. */
export const GROUP_ACTIVITY_ROLES: readonly string[] = ["owner", "admin"];
export const GROUP_ACTIVITY_REFUSED =
  "Changes across the group are for the owner and an administrator. Ask one of them.";
export const maySeeGroupActivity = (client: Client, hotelId: string) =>
  holdsRoleHere(client, hotelId, GROUP_ACTIVITY_ROLES);

/** May the signed-in person switch this hotel's modules? */
export const maySwitchModules = (client: Client, hotelId: string) =>
  holdsRoleHere(client, hotelId, MODULE_SWITCH_ROLES);
