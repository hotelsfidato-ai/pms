import { Package, Wine } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* The store — what the property keeps on its shelves. Assembled by
   `navigation.ts`, in the Store and equipment section.

   RESOURCE `stock`, NOT `inventory` (16 September). It shared room
   availability's grant, so everybody who could change availability —
   reception included — could change stock, and so could the Viewer (STO-1). */
export const nav: ServiceNavEntry[] = [
  /* The kitchen manager's too: the owner's D22-19, 22 September. */
  { section: "store-and-equipment", order: 10,
    workingMenus: ["housekeeping", "stores", "kitchen_manager"],
    label: "Store", to: "/h/:code/stores", icon: Package, resource: "stock",
    keywords: ["stock", "inventory", "stores"], matchPrefix: true },
  /* Inventory: the bar's stock, the restaurant's to come (the owner's D27-354). */
  { section: "store-and-equipment", order: 12,
    workingMenus: ["stores"],
    label: "Inventory", to: "/h/:code/inventory", icon: Wine, resource: "stock",
    keywords: ["bar", "liquor", "pegs", "drinks", "bar stock"], matchPrefix: true },
];
