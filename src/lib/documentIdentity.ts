import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";

/* ══════════════════════════════════════════════════════════════════
   WHOSE DOCUMENT IS THIS, AND WHO PRINTED IT

   Every report and every printed document carries two facts about
   itself: the property it is for, and the person who produced it. Both
   were STRING LITERALS.

   `ReportShell` defaulted `property` to "5 Elements By Fidato Hotels"
   and no caller has ever passed the prop — thirty report screens, none
   of them. The footer's user was the literal `"front desk"`. So a
   Manager Report run by the general manager at a second property
   printed another hotel's name over a figure that was not that
   hotel's, above a line naming somebody who did not run it.

   Both facts are already known: the property from the one in view, the
   person from their own session. Neither is invented here — when
   either is not loaded yet, the caller prints a dash, because a dash on
   a document is an honest gap and a plausible wrong name is not.
   ══════════════════════════════════════════════════════════════════ */

export interface DocumentIdentity {
  /** The property in view, by name. Null until the session has it. */
  property: string | null;
  /** The signed-in person's own name. Null until the session has it. */
  user: string | null;
}

export function useDocumentIdentity(): DocumentIdentity {
  const hotels = useSession((s) => s.hotels);
  const fullName = useSession((s) => s.scope?.fullName);
  const code = useUi((s) => s.hotelId);

  /* THE PROPERTY IN VIEW IS THE CODE, as everywhere else. No falling
     back to the first hotel in the list: that is how the Dashboard
     printed AGR's figures under a 5EL menu (MEMORY 254's neighbour),
     and on a printed report it would be worse — nothing on the page
     would say which hotel it belonged to. */
  const property = code
    ? (hotels.find((h) => h.code === code)?.name ?? null)
    : null;

  return { property, user: fullName ?? null };
}
