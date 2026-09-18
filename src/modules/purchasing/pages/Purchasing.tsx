import { ClipboardCheck, ShoppingCart, Truck } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Purchasing — COMING SOON. The owner chose it as its own service on
   16 September (decision S8, docs/STOCK-AND-EQUIPMENT-PLAN.md), because it
   serves both the Store and Equipment. Built in phase 2C; until then this
   page says what it will do and what exists today — nothing invented. */
const CONTENT: ComingSoonContent = {
  title: "Purchasing",
  summary: "Asking for something, getting it approved, ordering it from a supplier, and receiving it into the store or the equipment register.",
  status: "Planned",
  willDo: [
    { icon: ShoppingCart, title: "A request",
      body: "The store keeper, the kitchen manager or the hotel manager asks for what is needed." },
    { icon: ClipboardCheck, title: "An approval",
      body: "The general manager approves, and the owner above a limit the owner sets." },
    { icon: Truck, title: "An order, and the delivery",
      body: "An order to a supplier; what arrives lands in the store as stock, or in the register as equipment." },
  ],
  needs: [
    "The Store and Equipment built first, so a delivery has somewhere to land.",
    "Your suppliers entered at each property.",
    "The amount above which the owner approves, rather than the general manager. It is yours to set; nothing is assumed.",
  ],
  today: "A purchase can already be sent for approval. The store records a delivery with its supplier written as text, and nothing links the two.",
  leansOn: ["Store", "Equipment", "Approvals", "Suppliers"],
};

export default function PurchasingPage() {
  return <ComingSoonPage content={CONTENT} />;
}
