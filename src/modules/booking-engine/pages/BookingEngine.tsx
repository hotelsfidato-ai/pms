import { CalendarPlus, CalendarRange, MailCheck } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Booking engine — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Booking engine",
  summary: "Direct bookings from each hotel's own website, with no booking site in between and no commission to pay.",
  willDo: [
    { icon: CalendarRange, title: "Real dates, real prices",
      body: "A guest picks dates and sees what is left and what it costs, from the rate calendar. A room nobody has priced is not offered." },
    { icon: CalendarPlus, title: "Booked in one go",
      body: "The booking lands here like any other, filed under the hotel's website as its source." },
    { icon: MailCheck, title: "Confirmed at once",
      body: "The guest has a confirmation as soon as the booking is made." },
  ],
  needs: [
    "Whether it lives here or in the Fidato CRS.",
    "Each hotel's website, and who looks after it.",
    "Online payments, if a deposit should hold the room, and guest messages for the confirmation.",
  ],
  today: "Every booking is entered by staff. Nothing takes a reservation from a guest.",
  leansOn: ["Rate calendar", "New booking", "Booking sources"],
};

export default function BookingEnginePage() {
  return <ComingSoonPage content={CONTENT} />;
}
