import { FilePen } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Contracts — negotiated rates and allotments — not built. Its page sits
   under Distribution, marked "Not built yet" (D27-87), for the owner, admins
   and general managers only. Assembled by `navigation.ts`. When the service
   is built its real screens take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 40, notBuilt: true,
    label: "Contracts", to: "/coming-soon/contracts", icon: FilePen, resource: "integration",
    canSee: seesComingSoon, keywords: ["corporate rate", "negotiated rate", "allotment", "agent contract", "release"] },
];
