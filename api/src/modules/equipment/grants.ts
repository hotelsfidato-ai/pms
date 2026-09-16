import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT WITH THE EQUIPMENT REGISTER — on the server

   The owner's table of 16 September (docs/STOCK-AND-EQUIPMENT-PLAN.md
   § 6): owner, admin and GM everything; Hotel Manager see, add, edit;
   Store Manager, Kitchen Manager, Chef, Housekeeping and Reception see;
   Accountant see and export; Viewer see; Revenue Manager and Till
   Operator nothing.

   ⚠ THESE LISTS ARE A COPY of the `equipment` grants in
   `src/lib/permissions.ts`. The server does not import the website's
   code, so the two are held together by
   `api/test/modules/equipment/grants.test.ts`, which fails the moment
   any list here differs from `grantsFor(role, "equipment")`. When the
   owner changes the table, both change in the same commit.

   The role is read the way the website reads it (`useRole`) and the
   way inventory's `rateSetters.ts` reads it: a group administrator
   counts as the owner everywhere; anybody else has the role their
   `staff_hotels` row gives them AT THIS HOTEL, and no other.

   A hidden button is still a URL, and a POST body is still something
   anybody can send (root MEMORY 250, 263). Every route in `equipment.ts`
   asks this before it reads or writes anything.
   ══════════════════════════════════════════════════════════════════ */

export type EquipmentAction = "view" | "create" | "edit" | "approve" | "export";

export const EQUIPMENT_GRANTS: Readonly<Record<EquipmentAction, readonly string[]>> = {
  view: [
    "owner", "admin", "gm", "hotel_manager", "kitchen_manager", "chef",
    "front_desk", "stores", "housekeeping", "finance", "read_only",
  ],
  create: ["owner", "admin", "gm", "hotel_manager"],
  edit: ["owner", "admin", "gm", "hotel_manager"],
  approve: ["owner", "admin", "gm"],
  export: ["owner", "admin", "gm", "finance"],
};

/* How each role is named in a refusal. Rule 6: a refusal says who CAN,
   so the person knows whom to ask. Built from the lists above, so the
   sentence cannot disagree with the rule it states. */
const WHO: Readonly<Record<string, string>> = {
  owner: "the owner",
  admin: "an administrator",
  gm: "the general manager",
  hotel_manager: "the hotel manager",
  kitchen_manager: "the kitchen manager",
  chef: "a chef",
  front_desk: "reception",
  stores: "the store manager",
  housekeeping: "housekeeping",
  finance: "the accountant",
  read_only: "a viewer",
};

const DOING: Readonly<Record<EquipmentAction, string>> = {
  view: "Seeing the equipment register",
  create: "Adding equipment",
  edit: "Changing, moving or retiring equipment",
  approve: "Approving a retirement",
  export: "Exporting the equipment register",
};

const list = (roles: readonly string[]): string => {
  const names = roles.map((r) => WHO[r] ?? r);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
};

/** The sentence a refused person reads, naming who may. */
export const refusedFor = (action: EquipmentAction): string =>
  `${DOING[action]} is for ${list(EQUIPMENT_GRANTS[action])}. Ask one of them.`;

/** Exported for the test that proves every role in a list has a name. */
export const ROLE_NAMES = WHO;

/**
 * The signed-in person's role at this hotel, as the equipment register
 * reads it — `owner` for a group administrator, null for nobody here.
 */
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

export const mayDo = (role: string | null, action: EquipmentAction): boolean =>
  role !== null && EQUIPMENT_GRANTS[action].includes(role);
