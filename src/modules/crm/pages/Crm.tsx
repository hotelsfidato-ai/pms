import { Building2, Handshake, UserRound } from "lucide-react";
import { ComingSoonPage, type ComingSoonContent } from "@/pages/ComingSoon";

/* Central CRM — COMING SOON (the owner's decision, 16 September).

   What the service will do, what it needs before it can be built, and
   what exists today — nothing invented (`src/pages/ComingSoon.tsx`).
   Replaced by the real screens the day the service is built; the
   service's brief is this folder's MODULE.md. */
const CONTENT: ComingSoonContent = {
  title: "Central CRM",
  summary: "One record for each guest, company and partner hotel, whichever system they came through.",
  willDo: [
    { icon: UserRound, title: "One guest, one record",
      body: "Stays here, bookings in the CRS and WhatsApp conversations on the same person, across every hotel." },
    { icon: Building2, title: "Companies and agents, whole",
      body: "Everything an account has booked across the group, and what it owes." },
    { icon: Handshake, title: "Partner hotels in one place",
      body: "The hotels Fidato sells, their contacts and terms, beside the hotels it runs." },
  ],
  needs: [
    "A rule for recognising the same person in different systems, starting with the phone number stored the same way everywhere.",
    "The CRS and the leads app connected to this system first.",
    "Your decision on which record wins when two systems disagree.",
  ],
  today: "Guests and companies here are shared across hotels, but a returning guest gets a new record with each booking, and the CRS and the leads app keep their own.",
  leansOn: ["Guests", "Companies and agents", "Fidato CRS", "Leads and WhatsApp"],
};

export default function CrmPage() {
  return <ComingSoonPage content={CONTENT} />;
}
