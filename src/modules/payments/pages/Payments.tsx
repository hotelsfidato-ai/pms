import { Link, Undo2, Wallet } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Online payments — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Online payments",
  summary: "Taking money from guests online, by card and UPI, rather than only recording money that has already arrived.",
  status: "Parked",
  willDo: [
    { icon: Wallet, title: "A deposit to hold a room",
      body: "A guest pays part of the stay when booking, and it lands on the booking's bill." },
    { icon: Link, title: "A link to pay",
      body: "A payment link sent to a guest or a company, settled straight onto the bill it belongs to." },
    { icon: Undo2, title: "Refunds and no-shows",
      body: "A refund returned the way it came, and a card held against a guest who never arrives." },
  ],
  needs: [
    "The owner's go-ahead. Online payments were parked by the owner on 8 September.",
    "The payment gateway (Razorpay, PayU and CCAvenue are the usual choices in India) and its merchant account.",
    "The account keys, kept in the server's settings, never on a screen or in a message.",
  ],
  today: "Payments are recorded: cash, card and UPI taken at the desk or the till are written against a bill. Nothing here takes money online.",
  leansOn: ["Folios", "Cashiering", "Guest messages"],
};

export default function PaymentsPage() {
  return <ComingSoonPage content={CONTENT} />;
}
