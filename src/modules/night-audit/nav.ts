import { BarChart3 } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* The night audit — first in the Reports section. Assembled by
   `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "reports", order: 10,
    label: "Night audit", to: "/h/:code/night-audit", icon: BarChart3, resource: "report",
    keywords: ["close the day", "end of day", "audit"] },
];
