import { Globe } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* The channel manager — not connected. Its page sits under Distribution,
   marked "Not built yet" (D27-87), for the owner, admins and general managers.
   From 16 September it was in the Coming soon section; before that it was in
   nobody's menu and a search away for anybody holding the `rate` grant
   (15 September). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 10, notBuilt: true,
    label: "Channel manager", to: "/h/:code/channels", icon: Globe, resource: "integration",
    canSee: seesComingSoon, keywords: ["staah", "ota", "channels"] },
];
