import { useMemo } from "react";
import { roleFor, useSession } from "@/lib/session";
import { isTestHotel } from "@/lib/testHotel";
import type { ApiHotel, ApiScope } from "@/lib/api";
import type { Role } from "@/lib/permissions";

/* The real hotels where the person works with a role that `may` (D27-383
   item 6): what a group report or a group price change may be asked of.
   As the server asks it (reports/group.ts, inventory/groupRates.ts): a
   group administrator is the owner everywhere; anybody else only where
   they are rostered, with that hotel's role. Test hotels never. */
export function hotelsWhere(
  may: (role: Role) => boolean,
  scope: ApiScope | null = useSession.getState().scope,
  hotels: ApiHotel[] = useSession.getState().hotels,
): ApiHotel[] {
  if (!scope) return [];
  return hotels.filter((h) => !isTestHotel(h)
    && (scope.isGroupAdmin || scope.hotels.some((g) => g.hotelId === h.id))
    && may(roleFor(scope, h.id)));
}

/** The same, as a hook: the screen redraws when the session changes. */
export function useHotelsWhere(may: (role: Role) => boolean): ApiHotel[] {
  const scope = useSession((s) => s.scope);
  const hotels = useSession((s) => s.hotels);
  return useMemo(() => hotelsWhere(may, scope, hotels), [scope, hotels, may]);
}
