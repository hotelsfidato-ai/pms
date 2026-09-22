import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { listBlacklistWarnings } from "@/modules/guests/data/people";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING SITE'S GUEST WHO MATCHES A BLACKLISTED GUEST (CRM-3)

   The owner's D22-8: a booking from a booking site - the channel
   manager's, or one typed in from a site - arrives with nobody to see the
   blacklist warning a clerk sees while typing (D21-21). So Arrivals and
   the check-in show it: this booking's phone or email is a blacklisted
   guest's, and the reason.

   The match is the desk's own - an exact phone or email (D21-20) - and it
   is only a warning. Nothing is joined for the clerk (D21-2) and nothing
   is refused: a person decides (D21-21).

   Front desk places it; this file owns what it says. `stayIds` is what
   that screen shows, so a warning is never about a row it is not showing.
   ══════════════════════════════════════════════════════════════════ */

export function BookingSiteBlacklist({
  hotelId, from, to, stayIds,
}: {
  hotelId: string;
  /** The arrival dates asked about, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  /** The stays on the screen; a warning about any other is not shown. */
  stayIds: readonly string[] | undefined;
}) {
  const found = useQuery({
    queryKey: ["blacklist-warnings", hotelId, from, to],
    queryFn: () => listBlacklistWarnings(hotelId, from, to),
    enabled: !!hotelId && !!from && !!to,
  });
  const shown = new Set(stayIds ?? []);
  const warnings = (found.data ?? []).filter((w) => shown.has(w.stayId));
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2" data-booking-site-blacklist>
      {warnings.map((w) => (
        <div key={`${w.stayId}-${w.blacklistedName}`} role="alert"
          className="flex items-start gap-2 rounded-md border border-brand-red-100 bg-brand-red-50 p-3 text-sm text-brand-red-700">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-medium">
              {w.guest} ({w.reference}, {w.source}) has the phone or email of {w.blacklistedName}, who is blacklisted.
            </span>{" "}
            Reason: {w.reason ?? "-"}. Check-in is not refused - you decide.
          </span>
        </div>
      ))}
    </div>
  );
}
