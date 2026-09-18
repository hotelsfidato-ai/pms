import { CalendarClock, CalendarRange, Handshake } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Contracts — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Contracts",
  summary: "Negotiated rates for companies and agents, and rooms held for them until a release date.",
  willDo: [
    { icon: Handshake, title: "A rate per account",
      body: "The rate agreed with a company or agent, used at booking instead of being typed." },
    { icon: CalendarRange, title: "Rooms held",
      body: "An allotment kept for an account until an agreed number of days before arrival, then released for sale." },
    { icon: CalendarClock, title: "Dates that end",
      body: "Each contract valid from and to, so an expired rate is not quoted." },
  ],
  needs: [
    "The contracts you have today, and their rates.",
    "The release rules agreed with each account.",
    "Who may change a contracted rate.",
  ],
  today: "Companies and their bills are recorded. A company's agreed rate is typed on each booking, and nothing holds rooms for an account.",
  leansOn: ["Companies and agents", "Rate calendar", "New booking"],
};

export default function ContractsPage() {
  return <ComingSoonPage content={CONTENT} />;
}
