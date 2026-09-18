import { Smartphone } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Online check-in — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 140,
    label: "Online check-in", to: "/coming-soon/online-checkin", icon: Smartphone, resource: "integration",
    canSee: seesComingSoon, keywords: ["web check-in", "registration card", "pre check-in", "id scan", "e-signature"] },
];
