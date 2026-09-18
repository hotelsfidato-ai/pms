import { Gauge, LineChart, Scale } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Revenue management — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Revenue management",
  summary: "What the coming months look like, and whether they are ahead of last year.",
  willDo: [
    { icon: LineChart, title: "Pace and pickup",
      body: "Rooms and revenue on the books for each coming month, against the same point last year." },
    { icon: Gauge, title: "A forecast",
      body: "Where each month is likely to finish, from what is booked and how fast it is booking." },
    { icon: Scale, title: "Budget against actual",
      body: "Each hotel's budget beside what it made, month by month." },
  ],
  needs: [
    "A year of bookings in this system to compare against.",
    "Each hotel's budget.",
    "Competitors' rates, if you want them. They come from a paid data service.",
  ],
  today: "The reports look back. Nothing compares what is booked for the coming months with last year.",
  leansOn: ["Manager report", "Rate calendar", "All reports"],
};

export default function RevenueManagementPage() {
  return <ComingSoonPage content={CONTENT} />;
}
