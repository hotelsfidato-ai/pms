import { ClipboardList, MapPin, Wrench } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Equipment — COMING SOON.

   The register of everything durable in the hotel, the restaurant and the
   rooms, with its repairs and the buying of new things. The owner gave this
   service that meaning on 16 September (decision S2,
   docs/STOCK-AND-EQUIPMENT-PLAN.md); until then this page described
   connections to room devices, which moved to Room systems unchanged.

   Built in phase 1B. Until then: what it will do, what it needs, and what
   exists today — nothing invented. */
const CONTENT: ComingSoonContent = {
  title: "Equipment",
  summary: "A register of everything durable in the hotel, the restaurant and the rooms: where it is, what it cost, its warranty, and its repairs.",
  status: "Planned",
  willDo: [
    { icon: ClipboardList, title: "The register",
      body: "Costly items one by one with a tag (an AC, a TV, an oven); cheap items by count per room." },
    { icon: MapPin, title: "Where each thing is",
      body: "In a room, the kitchen, the restaurant or a public area — and whether it is in use, under repair or retired." },
    { icon: Wrench, title: "Its repairs",
      body: "A repair reported against the item itself, with what it cost, so each item carries its own history." },
  ],
  needs: [
    "The list of what each property has — counted, and entered or imported. Nothing is assumed.",
    "Where things are: the kitchen, the restaurant, the lobby and the other places, entered once per property.",
    "Warranty and service-contract dates, where you have them.",
  ],
  today: "Nothing is recorded. A repair can be logged as a work order, but only against a room, not against the thing that broke.",
  leansOn: ["Rooms", "Work orders", "Suppliers", "Locations"],
};

export default function EquipmentPage() {
  return <ComingSoonPage content={CONTENT} />;
}
