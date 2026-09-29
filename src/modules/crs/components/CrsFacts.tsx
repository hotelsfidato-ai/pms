import { useQuery } from "@tanstack/react-query";
import { getCrsBookings } from "@/modules/crs/data/crs";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING'S CRS FACTS - for the booking's own panel (D27-168)

   "The booking shows its CRS number, salesperson and company", and any
   change made in the CRS since, not yet done. Draws NOTHING for a booking
   the CRS did not sell, or while it loads, so a panel that places it
   loses no space for every other booking.

   Placed by the screen that owns the booking panel (front desk); this
   service only offers it, through its front door.
   ══════════════════════════════════════════════════════════════════ */

export function CrsFacts({ code, reservationId }: { code: string; reservationId: string }) {
  const q = useQuery({
    queryKey: ["crs-bookings", code, reservationId],
    queryFn: () => getCrsBookings(code, reservationId),
    enabled: !!code && !!reservationId,
  });
  const b = q.data?.bookings[0];
  if (!b) return null;
  return (
    <div className="text-sm leading-relaxed">
      <p className="text-ink-900">
        <span className="font-medium tabular">CRS {b.crsReference}</span>
        {" · sold by "}{b.salesperson ?? "-"}
        {" · "}{b.company ?? "no company"}
      </p>
      {b.changeNote && !b.changeDone && (
        <p className="text-brand-red">Changed in the CRS: {b.changeNote}</p>
      )}
    </div>
  );
}
