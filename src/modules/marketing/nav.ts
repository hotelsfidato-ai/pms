import { Megaphone } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Marketing - BUILT 29 September (D27-168, D27-170): spend, campaigns and
   booked revenue by source for one month. Under Sales and marketing.

   Who sees it is the `marketing` grant (api/src/permissions.ts): the owner,
   an administrator and the GM (D22-17, D27-170). */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 20,
    label: "Marketing", to: "/h/:code/marketing", icon: Megaphone, resource: "marketing",
    keywords: ["campaigns", "ads", "meta", "attribution", "spend", "return on ad spend"] },
];
