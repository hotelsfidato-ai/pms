import { AlarmClock, ConciergeBell, PackageSearch } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { LOST_ROLES, REQUEST_ROLES, WAKE_UP_ROLES } from "@/modules/guest-services/requestRoles";

/* In the Front desk section, in the working menus of reception, housekeeping,
   the kitchen and the restaurant (D27-181). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "front-desk", order: 90,
    workingMenus: ["front_desk", "housekeeping", "kitchen_manager", "chef", "pos"],
    label: "Guest requests", to: "/h/:code/requests", icon: ConciergeBell, resource: "reservation",
    canSee: (role) => REQUEST_ROLES.includes(role),
    keywords: ["requests", "towels", "room service", "something broken", "concierge", "tasks"] },
  /* D27-241: wake-up calls in reception's menu; lost property in reception's
     and housekeeping's. */
  { section: "front-desk", order: 91, workingMenus: ["front_desk"],
    label: "Wake-up calls", to: "/h/:code/wake-up-calls", icon: AlarmClock, resource: "reservation",
    canSee: (role) => WAKE_UP_ROLES.includes(role), keywords: ["wake up", "alarm", "morning call"] },
  { section: "front-desk", order: 92, workingMenus: ["front_desk", "housekeeping"],
    label: "Lost property", to: "/h/:code/lost-property", icon: PackageSearch, resource: "reservation",
    canSee: (role) => LOST_ROLES.includes(role), keywords: ["lost and found", "found item", "left behind"] },
];
