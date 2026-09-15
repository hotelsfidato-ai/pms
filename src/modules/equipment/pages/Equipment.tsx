import { KeyRound, Phone, Tv } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Hotel equipment — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Hotel equipment",
  summary: "Door locks, room phones, minibars and TVs connected to the rooms and the bill.",
  status: "When a hotel asks",
  willDo: [
    { icon: KeyRound, title: "Key cards at check-in",
      body: "Cut for the room assigned, and cancelled at check-out." },
    { icon: Phone, title: "Calls on the bill",
      body: "Calls from a room charged to the stay without anyone typing them." },
    { icon: Tv, title: "Minibar and TV",
      body: "Minibar use charged to the room, and the TV greeting the guest by name." },
  ],
  needs: [
    "Which hotel wants which, and the brands installed. Onity, Salto and Hafele are common locks.",
    "The makers' connection documents.",
    "Possibly a small computer at the hotel, when a maker's system cannot be reached over the internet.",
  ],
  today: "Nothing is connected. The desk's Post a charge list has no telephone or minibar line.",
  leansOn: ["Rooms", "Folios"],
};

export default function EquipmentPage() {
  return <ComingSoonPage content={CONTENT} />;
}
