import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { dateCompact } from "@/lib/format";
import { useCurrentHotel, useRole } from "@/lib/session";
import { mayReach } from "./navigation";

/* A BUSINESS DATE BEHIND TODAY (the owner's D27-237): one line, on every
   screen, while the property's business date is behind its real date (the
   server's, in the hotel's own time zone - never this device's clock).
   Hidden when it is not behind, and on a screen with no property chosen. */
export function BusinessDateBehind() {
  const hotel = useCurrentHotel();
  const role = useRole();
  if (!hotel?.today || !hotel.businessDate || hotel.businessDate >= hotel.today) return null;
  const days = Math.round(
    (Date.parse(`${hotel.today}T00:00:00Z`) - Date.parse(`${hotel.businessDate}T00:00:00Z`)) / 86_400_000);
  const audit = mayReach(role, "/h/:code/night-audit");
  return (
    <p className="flex items-start gap-2 px-4 sm:px-5 py-1.5 bg-brand-yellow-50 border-b border-brand-yellow-100 text-sm text-ink-900"
      role="status" data-business-date-behind>
      <AlertTriangle className="size-4 text-warning-dark shrink-0 mt-0.5" />
      <span>
        Business date {dateCompact(hotel.businessDate)}, {days} {days === 1 ? "day" : "days"} behind
        today ({dateCompact(hotel.today)}). Close the days in{" "}
        {audit
          ? <Link to={`/h/${hotel.code}/night-audit`} className="font-medium underline underline-offset-2">Night audit</Link>
          : "Night audit"}.
      </span>
    </p>
  );
}
