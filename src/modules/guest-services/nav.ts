import { ConciergeBell } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Guest services — not built. Its page sits at the foot of the Front desk,
   marked "Not built yet" (D27-87), for the owner, admins and general managers
   only; reception's menu is unchanged. Assembled by `navigation.ts`. When
   the service is built its real screens take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "front-desk", order: 90, notBuilt: true,
    label: "Guest services", to: "/coming-soon/guest-services", icon: ConciergeBell, resource: "integration",
    canSee: seesComingSoon, keywords: ["requests", "wake-up call", "lost and found", "concierge", "tasks"] },
];
