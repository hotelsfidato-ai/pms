import { Award } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Loyalty - BUILT 30 September (D27-178, D27-179), under Sales and
   marketing. `resource: "customer"`, the Guests permission: the desk joins
   guests and uses their points here, and whoever sees guests may look. In
   nobody's working menu (the owner's lists of 15 September stay as they
   are); Find a screen reaches it. */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 30,
    label: "Loyalty", to: "/h/:code/loyalty", icon: Award, resource: "customer",
    keywords: ["membership", "points", "repeat guest", "rewards", "redeem", "member"] },
];
