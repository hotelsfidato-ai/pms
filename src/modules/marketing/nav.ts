import { Megaphone } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Marketing — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu. Assembled by
   `navigation.ts`. When the service is built its real screens take their
   place in a working section.

   Who sees it is the `marketing` grant (api/src/permissions.ts): the owner,
   an administrator and the GM (D22-17) - the same three who see Coming soon. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 130,
    label: "Marketing", to: "/coming-soon/marketing", icon: Megaphone, resource: "marketing",
    keywords: ["campaigns", "ads", "meta", "attribution", "return on ad spend"] },
];
