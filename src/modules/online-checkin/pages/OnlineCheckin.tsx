import { Link, PenLine, ScanLine } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Online check-in — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Online check-in",
  summary: "Guests give their details and ID before they arrive, so the desk only hands over the key.",
  willDo: [
    { icon: Link, title: "A link before arrival",
      body: "Name, address, arrival time and the people staying, filled in by the guest." },
    { icon: PenLine, title: "A digital registration card",
      body: "Signed on a phone or at the desk, and kept with the stay." },
    { icon: ScanLine, title: "ID read, not typed",
      body: "An ID photo read into the form, and Form C prepared for a foreign guest." },
  ],
  needs: [
    "Guest messages, to send the link.",
    "Your rule for ID photos: whether they are kept and for how long. They are personal data.",
    "The registration card wording each hotel uses.",
  ],
  today: "ID is recorded at the desk at check-in. Nothing reaches the guest before they arrive.",
  leansOn: ["Arrivals", "Guests", "Form C"],
};

export default function OnlineCheckinPage() {
  return <ComingSoonPage content={CONTENT} />;
}
