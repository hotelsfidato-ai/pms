import { Globe } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* The channel manager, under Distribution, for the owner, admins and general
   managers. Built (D27-178), so no longer marked "Not built yet" (D27-87);
   it sends nothing until SU is set up and the hotel is switched on.
   Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 10,
    label: "Channel manager", to: "/h/:code/channels", icon: Globe, resource: "integration",
    canSee: seesComingSoon, keywords: ["su", "ota", "channels", "booking sites"] },
];
