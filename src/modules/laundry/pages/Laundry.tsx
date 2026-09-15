import { ClipboardList, Receipt, Repeat } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Laundry — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Laundry",
  summary: "Guest laundry priced from a list and billed, and the hotel's linen counted out and back.",
  willDo: [
    { icon: ClipboardList, title: "A price list",
      body: "Each item and service priced once, for each hotel." },
    { icon: Receipt, title: "On the bill",
      body: "A guest's laundry recorded item by item and charged to the room." },
    { icon: Repeat, title: "Linen, counted",
      body: "Sheets and towels out to the laundry and back, so a shortfall shows the day it happens." },
  ],
  needs: [
    "Each hotel's laundry price list.",
    "Whether laundry is done in-house or sent out.",
    "How much linen each hotel should hold.",
  ],
  today: "The desk can post a Laundry charge to a bill by hand, typing the amount. Nothing prices it from a list or counts linen.",
  leansOn: ["Folios", "Housekeeping", "Store"],
};

export default function LaundryPage() {
  return <ComingSoonPage content={CONTENT} />;
}
