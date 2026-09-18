import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY WORK THE SU CONNECTION — the owner and an administrator

   D17-85, the owner on 17 September: "the owner AND an administrator"
   open the SU setup; a general manager sees the status page and no more.
   A group administrator counts as the owner everywhere (the rule
   `api/src/modules/admin/grants.ts` copies from the website's `roleFor`).

   Two questions, because SU's keys are the group's and its content is a
   hotel's:
     maySetUpSu     the login check - one pair of keys serves every hotel
     maySetUpSuAt   a hotel's SU details, mapping, sends and pushes

   ⚠ A COPY of what the screen asks (`src/modules/channel-manager/data/
   suRoles.ts`), because the server does not import the website's code.
   `api/test/modules/channel-manager/suLogin.test.ts` and the screen's own
   test fail if they drift. The `integration` grant in
   `src/lib/permissions.ts` is still the owner's alone; widening it to an
   administrator is the master's change, asked for in MODULE.md.
   ══════════════════════════════════════════════════════════════════ */

export const SU_ROLES = ["owner", "admin"] as const;

export const SU_REFUSED =
  "The SU connection is for the owner and an administrator. Ask one of them.";

export async function maySetUpSu(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
       select 1 from staff s
        where s.id = app.current_user_id() and s.is_active
          and (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.role = any($1::text[])))
     ) as may`,
    [SU_ROLES],
  );
  return rows[0]?.may === true;
}

export async function maySetUpSuAt(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
       select 1 from staff s
        where s.id = app.current_user_id() and s.is_active
          and (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.hotel_id = $1
                    and sh.role = any($2::text[])))
     ) as may`,
    [hotelId, SU_ROLES],
  );
  return rows[0]?.may === true;
}
