import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT IN THE STORE — on the server

   STO-1. Until 16 September no store route asked the caller's role, and
   the tables' row policies are hotel isolation only (069) — so reception,
   and the Viewer, could add an item, receive at a cost, undo a delivery
   and import a list. Phase 0 gave stock its own grants in the website's
   matrix; nothing on the server read them. This does.

   THE OWNER'S TABLE, 16 September (docs/STOCK-AND-EQUIPMENT-PLAN.md § 6),
   and what each grant means here:

     view    the list and an item's history
     create  a new item; receive, issue, wastage, return — every new
             movement except a correction (permissions.ts says the same)
     edit    an adjustment; an undo; changing an item that already exists,
             by hand or from a file (the owner's answer, 16 September:
             "a row that changes an existing item needs edit")

   There is no store export route, so `export` has no list here.

   ⚠ THESE LISTS ARE A COPY of `grantsFor(role, "stock")` in
   `src/lib/permissions.ts`. The server does not import the website's
   code, so the two are held together by
   `api/test/modules/stores/stockGrants.test.ts`, which fails the moment
   they differ. A change to who may do what is the owner's, made there by
   the master — and made here in the same commit.

   The role is read the way the website reads it (`useRole`): a group
   administrator counts as the owner everywhere; anybody else has the role
   their `staff_hotels` row gives them AT THIS HOTEL, and no other.
   ══════════════════════════════════════════════════════════════════ */

export type StockAction = "view" | "create" | "edit";

export const STOCK_ROLES: Readonly<Record<StockAction, readonly string[]>> = {
  view: ["owner", "admin", "gm", "hotel_manager", "stores", "kitchen_manager",
         "chef", "housekeeping", "finance", "read_only"],
  create: ["owner", "admin", "gm", "hotel_manager", "stores", "kitchen_manager"],
  edit: ["owner", "admin", "gm", "hotel_manager", "stores"],
};

/* Rule 6: say who CAN, so the person knows whom to ask. */
export const STOCK_REFUSED: Readonly<Record<StockAction, string>> = {
  view:
    "The Store is not open to your role. The owner, an administrator, the "
    + "general manager, the hotel manager, the store manager, the kitchen, "
    + "housekeeping, the accountant and a viewer can see it.",
  create:
    "Receiving, issuing, recording waste or a return, and adding an item are "
    + "for the owner, an administrator, the general manager, the hotel "
    + "manager, the store manager or the kitchen manager. Ask one of them.",
  edit:
    "Undoing a movement, correcting a count and changing an item already in "
    + "the store are for the owner, an administrator, the general manager, "
    + "the hotel manager or the store manager. Ask one of them.",
};

/** A correction is `edit`; every other movement is `create`. */
export const actionForKind = (kind: string): StockAction =>
  kind === "adjustment" ? "edit" : "create";

/** May the signed-in person do this to the store at this hotel? */
export async function mayStock(
  client: Client, hotelId: string, action: StockAction,
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
    [hotelId, STOCK_ROLES[action]],
  );
  return rows[0]?.may === true;
}
