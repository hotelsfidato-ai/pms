import { ClipboardList, Wrench } from "lucide-react";
import { canAccess } from "@/lib/permissions";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Housekeeping's menu entries — assembled into the one menu by
   `navigation.ts`. They sit in the Front desk section, beside the desk. */
export const nav: ServiceNavEntry[] = [
  { section: "front-desk", order: 40, workingMenus: ["housekeeping"],
    label: "Housekeeping", to: "/h/:code/housekeeping", icon: ClipboardList, resource: "inventory",
    keywords: ["clean", "dirty", "needs cleaning", "rooms to clean"],
    /* The board shows who is in each room and who leaves today, which the
       server gives only to those who read bookings (D27-142): not the chef
       and not the Inventory Manager. */
    canSee: (role) => canAccess(role, "reservation") },
  /* Beside housekeeping, because that is who finds most of it — and
     separate from a room block, because most work orders take no room
     out of service. */
  { section: "front-desk", order: 50, workingMenus: ["housekeeping"],
    label: "Work orders", to: "/h/:code/work-orders", icon: Wrench, resource: "room_config",
    keywords: ["repair", "maintenance", "broken", "out of order"],
    /* Housekeeping held no room_config grant, so the people this entry
       is placed beside could not see it. The API has no role gate on
       work orders — only the hotel's own row-level isolation. */
    canSee: (role) => canAccess(role, "room_config") || role === "housekeeping" },
];
