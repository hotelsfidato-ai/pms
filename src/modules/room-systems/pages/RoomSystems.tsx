import { KeyRound, Phone, Tv } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Room systems — COMING SOON.

   Until 16 September this page was "Hotel equipment". The owner then
   gave the word "Equipment" to the register of everything durable in the
   hotel (decision S2, docs/STOCK-AND-EQUIPMENT-PLAN.md), and the connections
   to devices in the rooms moved here under their own name. The content is
   unchanged — what it would do, what it needs, and what exists today. */
const CONTENT: ComingSoonContent = {
  title: "Room systems",
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

export default function RoomSystemsPage() {
  return <ComingSoonPage content={CONTENT} />;
}
