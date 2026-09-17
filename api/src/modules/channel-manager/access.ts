import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY WORK THE SU CONNECTION — the owner

   `src/lib/permissions.ts` gives the `integration` resource to the owner
   and to no other role, and a group administrator counts as the owner
   everywhere (the rule `api/src/modules/admin/grants.ts` copies from the
   website's `roleFor`). The server refuses what that matrix refuses:
   a hidden screen is still a URL (MEMORY 250, 263).

   Two questions, because SU's keys are the group's and its content is
   a hotel's:
     ownsAnyHotel   the login check — one pair of keys serves every hotel
     ownsHotel      a hotel's SU details, mapping and sends

   Whether an administrator or a GM should also reach these is the
   owner's decision, not this file's.
   ══════════════════════════════════════════════════════════════════ */

export const SU_OWNER_ONLY = "The SU connection is for the owner. Ask the owner.";

export async function ownsAnyHotel(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
       select 1 from staff s
        where s.id = app.current_user_id() and s.is_active
          and (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.role = 'owner'))
     ) as may`,
  );
  return rows[0]?.may === true;
}

export async function ownsHotel(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
       select 1 from staff s
        where s.id = app.current_user_id() and s.is_active
          and (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.hotel_id = $1
                    and sh.role = 'owner'))
     ) as may`,
    [hotelId],
  );
  return rows[0]?.may === true;
}
