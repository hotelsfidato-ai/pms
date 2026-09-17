import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT WITH A REPAIR — on the server

   REPORT A REPAIR ON A PIECE OF EQUIPMENT — the plan's table
   (docs/STOCK-AND-EQUIPMENT-PLAN.md § 6, approved 16 September): the
   owner, admin, GM, Hotel Manager, Inventory Manager, Kitchen Manager,
   chef, housekeeping and reception. The accountant and the viewer look.

   RECORD OR CANCEL A COST — the owner, D17-5 (17 September): Hotel
   Manager, Inventory Manager, GM, admin, owner.

   SEE A COST AND ITS PROOF — the owner, 17 September: those five and the
   accountant.

   ⚠ THESE LISTS ARE A COPY of `src/modules/housekeeping/repairRoles.ts`.
   The server does not import the website's code, so the two are held
   together by `api/test/modules/housekeeping/repairRoles.test.ts`.

   The role is read the way the website reads it (`useRole`) and the way
   inventory's `rateSetters.ts` reads it: a group administrator counts as
   the owner everywhere; anybody else has the role their `staff_hotels` row
   gives them AT THIS HOTEL, and no other. A hidden button is still a URL
   (root MEMORY 250, 263).
   ══════════════════════════════════════════════════════════════════ */

export const REPAIR_REPORTERS: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "stores",
  "kitchen_manager", "chef", "housekeeping", "front_desk",
];

export const COST_RECORDERS: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "stores",
];

export const COST_VIEWERS: readonly string[] = [...COST_RECORDERS, "finance"];

export const REPORT_REFUSED =
  "Reporting a repair on a piece of equipment is for the owner, an administrator, "
  + "the general manager, the hotel manager, the Inventory Manager, the kitchen, "
  + "housekeeping or reception. Ask one of them.";

export const COST_REFUSED =
  "Recording a repair cost is for the owner, an administrator, the general manager, "
  + "the hotel manager or the Inventory Manager. Ask one of them.";

/** The signed-in person's role at this hotel — `owner` for a group administrator. */
export async function roleAt(client: Client, hotelId: string): Promise<string | null> {
  const { rows } = await client.query<{ role: string | null }>(
    `select case
              when exists (select 1 from staff s
                            where s.id = app.current_user_id()
                              and s.is_active and s.is_group_admin)
              then 'owner'
              else (select sh.role
                      from staff_hotels sh
                      join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id()
                       and sh.hotel_id = $1
                       and s.is_active
                     limit 1)
            end as role`,
    [hotelId],
  );
  return rows[0]?.role ?? null;
}

export const may = (role: string | null, list: readonly string[]): boolean =>
  role !== null && list.includes(role);
