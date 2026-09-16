import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SET A PRICE — on the server

   INV-5, approved by the owner on 16 September: only the roles in
   `RATE_SETTER_ROLES` may set a price. The screen closes the Rate
   calendar with `canSee: setsRates`; this closes the write behind it,
   because a hidden menu entry is still a URL and a POST body is still
   something anybody can send (MEMORY 250, 263).

   ⚠ THIS LIST IS A COPY of `RATE_SETTER_ROLES` in `src/lib/permissions.ts`.
   The server does not import the website's code, so the two are held
   together by `api/test/modules/inventory/rateSetters.test.ts`, which
   fails the moment they differ. When a role joins that list — the
   revenue manager is on its way — it joins this one in the same commit.

   The role is read the way the website reads it (`useRole`): a group
   administrator counts as the owner everywhere; anybody else has the
   role their `staff_hotels` row gives them AT THIS HOTEL, and no other.
   ══════════════════════════════════════════════════════════════════ */

export const RATE_SETTER_ROLES: readonly string[] = ["owner", "admin", "gm"];

export const RATE_SETTER_REFUSED =
  "Setting a price is for the owner, an administrator or the general "
  + "manager. Ask one of them to change it.";

/** May the signed-in person set a price at this hotel? */
export async function setsRates(client: Client, hotelId: string): Promise<boolean> {
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
    [hotelId, RATE_SETTER_ROLES],
  );
  return rows[0]?.may === true;
}
