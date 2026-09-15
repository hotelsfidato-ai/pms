import { Clock, MailCheck, Receipt } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Guest messages — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Guest messages",
  summary: "The booking confirmation, a note before arrival, the bill and a thank-you, sent to guests on WhatsApp and email.",
  willDo: [
    { icon: MailCheck, title: "Confirmation on booking",
      body: "Sent when a booking is made, with the dates, the room and the hotel's details." },
    { icon: Clock, title: "A note before arrival",
      body: "The day before, with the check-in time, directions and a way to reply." },
    { icon: Receipt, title: "The bill after check-out",
      body: "The invoice sent to the guest or the company, so nobody has to ask for a copy." },
  ],
  needs: [
    "How messages go out: through the WhatsApp system the leads app already has, or a separate service.",
    "The WhatsApp number and the email address each hotel sends from.",
    "The message templates, approved by WhatsApp before they can be used.",
  ],
  today: "Nothing is sent to a guest. There is no email in the system at all.",
  leansOn: ["All bookings", "Arrivals", "Invoices"],
};

export default function GuestMessagingPage() {
  return <ComingSoonPage content={CONTENT} />;
}
