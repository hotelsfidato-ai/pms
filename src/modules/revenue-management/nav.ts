import { TrendingUp } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { setsRates } from "@/lib/permissions";

/* Revenue management - the first version (D18-15): what the coming nights
   look like, and what they suggest. It shows and it suggests and it never
   changes a price, so it sits beside the screens where a price IS changed,
   in Rooms and rates, after the Rate calendar.

   ⚠ IT LEFT THE COMING SOON SECTION when it was built, which is what
   `MODULE.md` said would happen. `src/components/app/navigation.test.ts`
   pins the Coming soon list and is the MASTER's file: "Revenue management"
   comes out of its `SOON` array in the same commit that merges this. The
   request is written up in MODULE.md under Requests (R2).

   WHO SEES IT: `setsRates` - the owner, an administrator, the GM and the
   Revenue Manager, which is the brief's list exactly and is already
   derived in `permissions.ts` from who holds `edit` on `rate`. The route
   guard asks the navigation, so this line closes the door as well as
   hiding it (PEO-1: a hidden entry is not a closed door). */
export const nav: ServiceNavEntry[] = [
  { section: "inventory", order: 30,
    label: "Revenue outlook", to: "/h/:code/revenue-outlook", icon: TrendingUp,
    resource: "rate", canSee: setsRates,
    keywords: [
      "revenue management", "pace", "pickup", "forecast", "yield",
      "soft dates", "budget", "rate shopping",
    ] },
];
