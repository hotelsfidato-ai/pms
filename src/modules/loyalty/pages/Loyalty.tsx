import { BadgePercent, Gift, IdCard } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Loyalty — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Loyalty",
  summary: "Returning guests recognised, rewarded and offered a member rate.",
  willDo: [
    { icon: IdCard, title: "Members",
      body: "A membership number, recognised at every hotel in the group." },
    { icon: Gift, title: "Stays that count",
      body: "Points or nights added up across the group, and what they earn." },
    { icon: BadgePercent, title: "A member rate",
      body: "A rate and benefits for members, used at booking." },
  ],
  needs: [
    "The programme's rules: points or stays, and what a member gets.",
    "The central CRM, so one guest is one member across hotels.",
    "How the member rate is set.",
  ],
  today: "A returning guest is not recognised: each booking creates a new guest record.",
  leansOn: ["Central CRM", "Rate calendar", "Guests"],
};

export default function LoyaltyPage() {
  return <ComingSoonPage content={CONTENT} />;
}
