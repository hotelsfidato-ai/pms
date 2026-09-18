import { IndianRupee, Target, TrendingUp } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Marketing — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Marketing",
  summary: "Which campaign brought which guest, what it cost and what it earned.",
  willDo: [
    { icon: Target, title: "Every lead traced to its ad",
      body: "The campaign and ad behind each WhatsApp enquiry, kept from the first message to the booking." },
    { icon: IndianRupee, title: "Spend against revenue",
      body: "What each campaign cost beside what its guests actually paid, for each hotel." },
    { icon: TrendingUp, title: "What to do more of",
      body: "Campaigns compared by bookings and revenue, not by clicks." },
  ],
  needs: [
    "Access to Meta Ads, and Google Ads if you use it, for what each campaign cost.",
    "Leads and WhatsApp connected to this system first.",
    "Booking figures confirmed by this system rather than typed by staff.",
  ],
  today: "The leads app records which ad each WhatsApp enquiry came from and adds up booking values staff type in. What a campaign cost is not recorded anywhere.",
  leansOn: ["Leads and WhatsApp", "Booking sources", "All reports"],
};

export default function MarketingPage() {
  return <ComingSoonPage content={CONTENT} />;
}
