import { MessageSquare } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Guest messages — BUILT (docs/BUILD-PLAN-2026-09-18.md § 4). Its entry
   left the Coming soon section and took its place under "Bookings",
   because what was sent to a guest is part of their booking and that is
   where somebody goes looking for it.

   ⚠ NO NEW SECTION AND NO NEW RESOURCE, deliberately. `SectionKey` and
   `RESOURCES` are the master's files, and laundry and spa each needed one
   only because nothing that already existed fitted (D18-8). This does fit:
   `reservation` is exactly who may see a guest's name, their number and
   their address today, so filing the record of what was sent to them
   under it gives NOBODY a screen they did not already have. The server
   asks the same question of the same list, because a hidden entry is
   still a URL anybody can type (STO-1 is what the other way round looks
   like).

   Reached from a booking as `?reservation=<id>`, which is the question
   the desk actually asks; the plain address is the property's whole list. */
export const nav: ServiceNavEntry[] = [
  { section: "bookings", order: 60,
    label: "Guest messages", to: "/h/:code/guest-messages", icon: MessageSquare,
    resource: "reservation",
    keywords: ["whatsapp", "email", "confirmation", "pre-arrival", "sent", "message", "sms"] },
];
