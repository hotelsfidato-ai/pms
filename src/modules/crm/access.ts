import type { Role } from "@/lib/permissions";

/** D21-4: the owner, an administrator and the general manager - who see a
    guest's whole history across the group, work the "possible same person"
    list, and blacklist (D21-21). Asked by the menu, each route's guard, and
    the stay panel's link alike, so none of them can disagree. */
export const seesGuest360 = (role: Role): boolean =>
  role === "owner" || role === "admin" || role === "gm";
