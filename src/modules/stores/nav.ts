import { Package } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* The store — what the property keeps on its shelves. Assembled by
   `navigation.ts`, in the Inventory section. */
export const nav: ServiceNavEntry[] = [
  { section: "inventory", order: 40, workingMenus: ["housekeeping", "stores"],
    label: "Store", to: "/h/:code/stores", icon: Package, resource: "inventory",
    keywords: ["stock", "inventory", "stores"], matchPrefix: true },
];
