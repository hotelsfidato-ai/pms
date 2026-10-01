import { ConciergeBell } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { REQUEST_ROLES } from "@/modules/guest-services/requestRoles";

/* In the Front desk section, in the working menus of reception, housekeeping,
   the kitchen and the restaurant (D27-181). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "front-desk", order: 90,
    workingMenus: ["front_desk", "housekeeping", "kitchen_manager", "chef", "pos"],
    label: "Guest requests", to: "/h/:code/requests", icon: ConciergeBell, resource: "reservation",
    canSee: (role) => REQUEST_ROLES.includes(role),
    keywords: ["requests", "towels", "room service", "something broken", "concierge", "tasks"] },
];
