import { ArrowRightLeft, CalendarRange, Send } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Fidato CRS — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Fidato CRS",
  summary: "Bookings made in the Fidato CRS arriving here by themselves, and each hotel's rooms and prices visible to the CRS's sales team.",
  willDo: [
    { icon: ArrowRightLeft, title: "Bookings, arriving by themselves",
      body: "A booking a salesperson makes in the CRS for a hotel on this system lands here with its guest, room type, nights and rate. Nobody types it twice." },
    { icon: CalendarRange, title: "Rooms and prices, from here",
      body: "The CRS shows what is left to sell and at what price, read from this system rather than typed into it." },
    { icon: Send, title: "The confirmation, sent back",
      body: "This system's booking reference goes back to the CRS as the hotel's confirmation number, so the voucher quotes what the desk will find." },
  ],
  needs: [
    "Which rooms 5 Elements actually has. This system has 18; the CRS's list has 17, in different room types.",
    "A safe way for another system to send a booking here: its own key, and a booking door that ignores a repeat of the same booking.",
    "The automation server given a public address, so the CRS can reach it.",
    "Your decision on who prices a CRS booking for a hotel on this system, so the voucher and the bill agree.",
  ],
  today: "The CRS runs on its own for 28 partner hotels. Nothing passes between it and this system yet.",
  leansOn: ["All bookings", "Rate calendar", "Guests"],
};

export default function CrsPage() {
  return <ComingSoonPage content={CONTENT} />;
}
