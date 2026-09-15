import { Globe } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* The channel manager — not connected. Its page sits in the Coming soon
   section with every other service the system does not have yet: the
   owner's decision of 16 September, for the owner, admins and general managers.
   Until then it was in nobody's menu and a search away for anybody holding
   the `rate` grant (15 September). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 40,
    label: "Channel manager", to: "/h/:code/channels", icon: Globe, resource: "integration",
    canSee: seesComingSoon, keywords: ["staah", "ota", "channels"] },
];
