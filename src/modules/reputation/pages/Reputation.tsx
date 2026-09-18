import { Reply, Send, Star } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Reviews — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Reviews",
  summary: "Each hotel's reviews from Google, TripAdvisor and the booking sites in one place, and answered.",
  willDo: [
    { icon: Star, title: "Every review, one list",
      body: "Reviews gathered for each hotel as they arrive, with the rating and where they were left." },
    { icon: Reply, title: "Replied to from here",
      body: "An answer written once and posted where the review was left." },
    { icon: Send, title: "Asked after every stay",
      body: "A short feedback request to each guest after check-out." },
  ],
  needs: [
    "Each hotel's Google Business profile and its booking-site accounts.",
    "Guest messages, for the feedback request.",
    "Who replies to reviews at each hotel.",
  ],
  today: "Nothing about reviews is recorded here.",
  leansOn: ["Guest messages", "Guests"],
};

export default function ReputationPage() {
  return <ComingSoonPage content={CONTENT} />;
}
