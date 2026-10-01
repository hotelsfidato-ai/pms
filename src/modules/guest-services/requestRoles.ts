import type { Role } from "../../lib/permissions";

/* Who sees Guest requests (D27-181) - the website's copy. The desk (owner,
   admin, GM, hotel manager, reception) and each team that receives them:
   housekeeping, the Inventory Manager (a repair, D22-34), the kitchen
   manager, chef and waiter. The server's `teamsFor`
   (api/src/modules/guest-services/requests.ts) gives exactly these a team;
   api/test/modules/guest-services/requests.test.ts holds the two together. */
export const REQUEST_ROLES: readonly Role[] = [
  "owner", "admin", "gm", "hotel_manager", "front_desk",
  "housekeeping", "stores", "kitchen_manager", "chef", "pos",
];
