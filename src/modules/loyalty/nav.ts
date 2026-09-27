import { Award } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Loyalty — not built. Its page sits under Sales and marketing, marked "Not
   built yet" (D27-87), for the owner, admins and general managers only.
   Assembled by `navigation.ts`. When the service is built its real screens
   take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 30, notBuilt: true,
    label: "Loyalty", to: "/coming-soon/loyalty", icon: Award, resource: "integration",
    canSee: seesComingSoon, keywords: ["membership", "points", "repeat guest", "member rate", "rewards"] },
];
