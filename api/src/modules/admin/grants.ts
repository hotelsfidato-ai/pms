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
   the master — and changed here in the same commit.

   The role is read the way the website reads it (`roleFor`): a group
   administrator counts as the owner everywhere; anybody else has the
   role their `staff_hotels` row gives them AT THIS HOTEL, and no other.
   ══════════════════════════════════════════════════════════════════ */

export type AdminRead = "audit_log" | "setting";

export const ADMIN_READ_ROLES: Readonly<Record<AdminRead, readonly string[]>> = {
  audit_log: ["owner", "admin", "gm"],
  /* Not the GM. The matrix has never given the GM `setting`, and the
     Settings screen has always refused them; this makes the server agree. */
  setting: ["owner", "admin"],
};

/* Rule 6: say who CAN, so the person knows whom to ask. */
export const ADMIN_READ_REFUSED: Readonly<Record<AdminRead, string>> = {
  audit_log:
    "The audit log is open to the owner, an administrator and the general "
    + "manager. Ask one of them.",
  setting:
    "Settings are open to the owner and an administrator. Ask one of them.",
};

/** May the signed-in person read this at this hotel? */
export async function mayRead(
  client: Client, hotelId: string, what: AdminRead,
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
              select 1 from staff s
               where s.id = app.current_user_id() and s.is_active and s.is_group_admin
            )
         or exists (
              select 1 from staff_hotels sh
                join staff s on s.id = sh.staff_id
               where sh.staff_id = app.current_user_id()
                 and sh.hotel_id = $1
                 and s.is_active
                 and sh.role = any($2::text[])
            ) as may`,
    [hotelId, ADMIN_READ_ROLES[what]],
  );
  return rows[0]?.may === true;
}
