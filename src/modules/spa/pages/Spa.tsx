import { CalendarClock, Receipt, Sparkles } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Spa — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Spa",
  summary: "Treatments booked, therapists scheduled, and the charge on the guest's bill.",
  willDo: [
    { icon: Sparkles, title: "A treatment menu",
      body: "Each hotel's treatments, their length and their price." },
    { icon: CalendarClock, title: "Appointments",
      body: "Booked by therapist and treatment room, so nobody is double-booked." },
    { icon: Receipt, title: "On the bill",
      body: "Charged to the guest's room or paid at the spa, under the spa's own tax rule." },
  ],
  needs: [
    "Which hotels have a spa, and its treatments and prices.",
    "The therapists and their hours.",
    "The tax rule for spa services at each hotel.",
  ],
  today: "Nothing here books a treatment, and the desk's Post a charge list has no Spa line.",
  leansOn: ["Folios"],
};

export default function SpaPage() {
  return <ComingSoonPage content={CONTENT} />;
}
