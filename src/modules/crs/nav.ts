import { Network } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Fidato CRS — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 60,
    label: "Fidato CRS", to: "/coming-soon/crs", icon: Network, resource: "integration",
    canSee: seesComingSoon, keywords: ["crs", "central reservations", "partner hotels", "sales team"] },
];
