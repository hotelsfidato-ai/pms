import { KeyRound } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Room systems — not built. Door locks, room phones, minibar and TV. Was the
   "Hotel equipment" entry until 16 September, when "Equipment" became the
   register of durable things (decision S2). It sits at the foot of System,
   marked "Not built yet" (D27-87), for the owner, admins and general managers
   only. */
export const nav: ServiceNavEntry[] = [
  { section: "system", order: 90, notBuilt: true,
    label: "Room systems", to: "/coming-soon/room-systems", icon: KeyRound, resource: "integration",
    canSee: seesComingSoon, keywords: ["door lock", "key card", "pabx", "telephone", "minibar", "iptv", "energy"] },
];
