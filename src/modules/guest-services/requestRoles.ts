import type { Role } from "../../lib/permissions";

/* Who sees Guest requests (D27-181) - the website's copy. The desk (owner,
   admin, GM, hotel manager, reception) and each team that receives them:
   housekeeping, the Inventory Manager (a repair, D22-34), the kitchen
   manager, chef, waiter and Bar (D27-329 (3)). The server's `teamsFor`
   (api/src/modules/guest-services/requests.ts) gives exactly these a team;
   api/test/modules/guest-services/requests.test.ts holds the two together. */
export const REQUEST_ROLES: readonly Role[] = [
  "owner", "admin", "gm", "hotel_manager", "front_desk",
  "housekeeping", "stores", "kitchen_manager", "chef", "pos", "bar",
];

/* Wake-up calls: the desk (D27-241). Lost property: the desk and housekeeping
   log and see; the desk alone returns or disposes. The server's
   wakeAndLost.ts holds the same lists. */
export const WAKE_UP_ROLES: readonly Role[] = ["owner", "admin", "gm", "hotel_manager", "front_desk"];
export const LOST_ROLES: readonly Role[] = [...WAKE_UP_ROLES, "housekeeping"];
