import { Armchair } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Equipment — not built. The register of durable things in the hotel, the
   restaurant and the rooms (decision S2, 16 September). Its Coming soon page
   sits in the Coming soon section for the owner, admins and general managers;
   when phase 1B builds it, the real screen moves to the Store and equipment
   section with `resource: "equipment"`.

   Was "Hotel equipment", meaning door locks and room phones. Those moved to
   Room systems. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 55,
    label: "Equipment", to: "/coming-soon/equipment", icon: Armchair, resource: "integration",
    canSee: seesComingSoon, keywords: ["asset", "register", "repair", "warranty", "amc", "furniture", "appliance", "ac", "tv"] },
];
