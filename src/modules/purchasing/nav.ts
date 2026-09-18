import { ShoppingCart } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Purchasing — not built. Its Coming soon page sits in the Coming soon
   section for the owner, admins and general managers. When it is built
   (plan phase 2C) its screens move into the Store and equipment section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 155,
    label: "Purchasing", to: "/coming-soon/purchasing", icon: ShoppingCart, resource: "integration",
    canSee: seesComingSoon, keywords: ["purchase", "order", "supplier", "buy", "requisition", "po"] },
];
