import { CalendarPlus } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Booking engine — not built. Its page sits under Distribution, marked
   "Not built yet" (D27-87), for the owner, admins and general managers only.
   Assembled by `navigation.ts`. When the service is built its real screens
   take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 20, notBuilt: true,
    label: "Booking engine", to: "/coming-soon/booking-engine", icon: CalendarPlus, resource: "integration",
    canSee: seesComingSoon, keywords: ["direct booking", "website booking", "book now", "web booking"] },
];
