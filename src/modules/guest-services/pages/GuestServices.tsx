import { AlarmClock, ClipboardList, Search } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Guest services — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Guest services",
  summary: "Guest requests, wake-up calls and lost property, logged and followed through.",
  willDo: [
    { icon: ClipboardList, title: "Requests, closed",
      body: "A towel, a taxi, a late breakfast: logged, given to someone and marked done." },
    { icon: AlarmClock, title: "Wake-up calls",
      body: "On one list for the night staff, so none is missed." },
    { icon: Search, title: "Lost and found",
      body: "What was found, where, and who collected it." },
  ],
  needs: [
    "Which requests each hotel handles, and who answers them.",
    "How a guest asks: at the desk, by phone or on WhatsApp.",
    "How long lost property is kept.",
  ],
  today: "Maintenance jobs are logged as work orders under Housekeeping. Guest requests, wake-up calls and lost property are not recorded.",
  leansOn: ["Housekeeping", "Work orders", "In house"],
};

export default function GuestServicesPage() {
  return <ComingSoonPage content={CONTENT} />;
}
