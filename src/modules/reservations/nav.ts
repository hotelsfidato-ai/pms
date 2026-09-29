import { CalendarCheck, Users, BookPlus } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { can } from "@/lib/permissions";

/* Reservations' menu entries — the Bookings section, interleaved with the
   guests service's by `order`. Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  {
    section: "bookings", order: 10, workingMenus: ["front_desk"],
    label: "All bookings", to: "/h/:code/reservations", icon: CalendarCheck,
    resource: "reservation",
    keywords: ["reservations", "booking", "find a booking"], matchPrefix: true,
  },
  /* A wedding is one conversation and nine rooms. Every other list
     here shows those nine as nine unrelated bookings, so the person
     taking the call had to hold the relationship in their head. */
  { section: "bookings", order: 30,
    label: "Groups", to: "/h/:code/groups", icon: Users, resource: "reservation", matchPrefix: true },
  /* One guest, one set of nights, several rooms — and a group made
     for them automatically when there is more than one. */
  { section: "bookings", order: 50, workingMenus: ["front_desk"],
    label: "New booking", to: "/h/:code/book", icon: BookPlus, resource: "reservation",
    /* Only for whoever may make one: the server's BOOK rule (QA RO-4 - the
       Viewer and the Accountant were offered it). */
    canSee: (role) => can(role, "create", "reservation"),
    keywords: ["reservation", "book a room"] },
];
