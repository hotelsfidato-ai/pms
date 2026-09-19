import { IndianRupee, Shirt } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Laundry — BUILT. Its entry left the Coming soon section and took its
   place in the "Laundry" section the master added on 18 September for
   D17-54's two per-hotel services.

   THE SECTION CARRIES THE SWITCH, not these entries. `module: "laundry"`
   sits on the section in `navigation.ts`, which is the only place a whole
   service hides at a property that has not switched it on — absent, not
   greyed, the rule the point of sale and the banquet already follow. And
   it is the tidy half only: every route asks `app.module_enabled` on its
   own, because a hidden menu entry is still a URL anybody can type.

   WHO SEES IT is `resource: "laundry"` in src/lib/permissions.ts, which
   D18-8 already decided — reception and housekeeping, and no new roles.

   NO `workingMenus`. An entry in a role's working menu changes what that
   role finds pinned in front of them, and that is the owner's call, not
   this lane's. Until they make it, laundry is in the full menu for
   everybody who holds the resource, and one search away for all of them. */
export const nav: ServiceNavEntry[] = [
  { section: "laundry", order: 10,
    label: "Dockets", to: "/h/:code/laundry", icon: Shirt, resource: "laundry",
    matchPrefix: true,
    keywords: ["laundry", "docket", "linen", "bag", "dry cleaning", "valet", "ironing", "wash"] },
  { section: "laundry", order: 20,
    label: "Price list", to: "/h/:code/laundry/price-list", icon: IndianRupee,
    resource: "laundry",
    keywords: ["laundry price", "wash rate", "press rate", "dry-clean price", "tariff"] },
];
