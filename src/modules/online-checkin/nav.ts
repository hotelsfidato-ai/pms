import { Smartphone } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";

/* Online check-in's desk screen — BUILT 21 September, and out of Coming soon
   the same day (the owner's D21-89): under Front desk, and in reception's own
   menu, because reception is who confirms a guest's details against the ID
   and reprints a lost room card.

   WHO SEES IT is the server's list, exactly — `DESK_ROLES` in
   api/src/routes/guestDoor.ts: owner, admin, GM, hotel manager, reception.
   Not the Guests grant (`customer`), which also reaches the accountant and a
   viewer: the server refuses both, and a menu that offers somebody a screen
   that refuses them reads as a broken system (SPA-2's lesson). If the server
   list changes, this one changes with it. */
const DESK_ROLES: readonly Role[] = ["owner", "admin", "gm", "hotel_manager", "front_desk"];

export const nav: ServiceNavEntry[] = [
  { section: "front-desk", order: 35, workingMenus: ["front_desk"],
    label: "Online check-in", to: "/h/:code/online-checkin", icon: Smartphone, resource: "customer",
    canSee: (role) => DESK_ROLES.includes(role),
    keywords: ["web check-in", "pre check-in", "guest details", "room card", "qr", "guest requests"] },
];
