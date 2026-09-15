import { CalendarPlus, Inbox, Timer } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Leads and WhatsApp — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Leads and WhatsApp",
  summary: "Every enquiry from a Meta ad or a WhatsApp message, answered on time and followed through to a booking.",
  willDo: [
    { icon: Inbox, title: "One inbox",
      body: "WhatsApp enquiries routed to the right hotel and assigned to whoever is on duty." },
    { icon: Timer, title: "Answered on time",
      body: "A response clock on every enquiry; one left unanswered goes to a manager." },
    { icon: CalendarPlus, title: "Followed to a booking",
      body: "Follow-ups, calls and notes on each enquiry, and a booked one becomes a real booking here." },
  ],
  needs: [
    "The WhatsApp workflows moved onto this system's server, and the Meta token renewed before about 27 September.",
    "A booking here able to record the enquiry it came from.",
    "Which rooms 5 Elements actually has, so the availability the team quotes matches this system.",
  ],
  today: "It is being built as a separate app, live-inventory1.web.app, for six hotels; its inbox waits on the WhatsApp workflows being switched on. Nothing passes between it and this system yet.",
  leansOn: ["New booking", "Guests", "Booking sources"],
};

export default function LeadsPage() {
  return <ComingSoonPage content={CONTENT} />;
}
