import { Megaphone } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Marketing — not built. Its page sits under Sales and marketing, marked
   "Not built yet" (D27-87). Assembled by `navigation.ts`. When the service is
   built its real screens take its place and the mark goes.

   Who sees it is the `marketing` grant (api/src/permissions.ts): the owner,
   an administrator and the GM (D22-17) - the same three who see the other
   services not built yet. */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 20, notBuilt: true,
    label: "Marketing", to: "/coming-soon/marketing", icon: Megaphone, resource: "marketing",
    keywords: ["campaigns", "ads", "meta", "attribution", "return on ad spend"] },
];
