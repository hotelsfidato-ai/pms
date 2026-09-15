import { ConciergeBell } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Guest services — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 80,
    label: "Guest services", to: "/coming-soon/guest-services", icon: ConciergeBell, resource: "integration",
    canSee: seesComingSoon, keywords: ["requests", "wake-up call", "lost and found", "concierge", "tasks"] },
];
