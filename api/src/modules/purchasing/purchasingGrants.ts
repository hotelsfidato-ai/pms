import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY SEE AND CHANGE PURCHASING — on the server

   Three different questions, and they have three different answers.
   Putting them in one list is how STO-1 happened.

   1. WHO MAY LOOK       `grantsFor(role, "purchasing")` in
                         src/lib/permissions.ts — the matrix that was
                         written when the resource was reserved and has
                         never had anything behind it until now.

   2. WHO MAY RAISE, PRICE, ORDER AND CANCEL
                         NOT a list here. It is `purchase_requesters`, a
                         SETTING PER PROPERTY the owner changes without a
                         deploy (D18-2), asked through
                         `app.may_raise_purchase()`. One list, held in
                         one place, which is the whole point of D18-2 —
                         and the same list does the ordering, because the
                         owner's D18-3 is that the order is sent by hand
                         "by whoever orders".

   3. WHO MAY RECEIVE A DELIVERY
                         NOT here either. Putting stock on a shelf is the
                         Store's rule and the Store keeps it: the
                         delivery route asks `mayDeliverInto`, exported
                         by the Store's own front door.

   4. WHO MAY CHANGE THE SETTING ITSELF
                         The owner and an administrator. Widening who may
                         buy things is exactly the kind of change the
                         approvals engine already reserves for the owner
                         ("Only the owner can change who approves what",
                         api/src/routes/approvals.ts); an administrator is
                         added because D18-2 names them as somebody who
                         may already raise one, and the owner asked for a
                         setting they can hand over.

   ⚠ VIEW_ROLES IS A COPY of the matrix. The server does not import the
   website's code, so the two are held together by
   api/test/modules/purchasing/purchasingGrants.test.ts, which fails the
   moment they differ — the shape stockGrants.ts uses beside it.
   ══════════════════════════════════════════════════════════════════ */

/** The roles holding `view` on `purchasing`. A COPY — see above. */
export const VIEW_ROLES: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "kitchen_manager", "stores",
  "finance", "read_only",
];

/** The roles that may change who may raise a request. */
export const SETTING_KEEPERS: readonly string[] = ["owner", "admin"];

export const PURCHASING_REFUSED = {
  view:
    "Purchasing is not open to your role. The owner, an administrator, the "
    + "general manager, the hotel manager, the Inventory Manager, the kitchen "
    + "manager, the accountant and a viewer can see it.",
  raise:
    "Raising a purchase request here is a setting for this property, and your "
    + "role is not on it. The owner or an administrator can add it, on the "
    + "Purchasing screen.",
  setting:
    "Changing who may raise a purchase request is for the owner or an "
    + "administrator. Ask one of them.",
} as const;

/** Does the signed-in person hold one of these roles at this property? A
    group administrator holds everything everywhere, as they do throughout
    this system (api/src/routes/approvals.ts, `meAt`). */
export async function hasRoleAt(
  client: Client, hotelId: string, roles: readonly string[],
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
    [hotelId, roles],
  );
  return rows[0]?.may === true;
}

/** The setting, asked in the database so a screen, a later endpoint and a
    script all get one answer (116). */
export async function mayRaise(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    "select app.may_raise_purchase($1) as may", [hotelId]);
  return rows[0]?.may === true;
}
