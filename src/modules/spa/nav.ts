import { Flower2 } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Spa — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 180,
    label: "Spa", to: "/coming-soon/spa", icon: Flower2, resource: "integration",
    canSee: seesComingSoon, keywords: ["wellness", "massage", "treatment", "therapist"] },
];
