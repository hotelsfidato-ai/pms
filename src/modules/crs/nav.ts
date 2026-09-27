import { Network } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Fidato CRS — not built. Its page sits under Distribution, marked "Not
   built yet" (D27-87), for the owner, admins and general managers only.
   Assembled by `navigation.ts`. When the service is built its real screens
   take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 30, notBuilt: true,
    label: "Fidato CRS", to: "/coming-soon/crs", icon: Network, resource: "integration",
    canSee: seesComingSoon, keywords: ["crs", "central reservations", "partner hotels", "sales team"] },
];
