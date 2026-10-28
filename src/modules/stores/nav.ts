import { Package, Wine } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";

/* Who opens Bar stock from the Restaurant menu: the owner, an Admin, the GM
   and the Bar role, the bar manager (the owner, 21 October evening). The
   Inventory Manager has it as Inventory's Bar tab. The server's list is
   api/src/modules/stores/stockGrants.ts BAR_KEEPERS. */
const BAR_STOCK: readonly Role[] = ["owner", "admin", "gm", "bar"];

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
  /* Inventory: the bar's stock (the owner's D27-354) and the kitchen's, with
     its recipes (D27-373, D27-374). */
  { section: "store-and-equipment", order: 12,
    workingMenus: ["stores"],
    label: "Inventory", to: "/h/:code/inventory", icon: Wine, resource: "stock",
    keywords: ["bar", "liquor", "pegs", "drinks", "bar stock", "kitchen stock", "recipes", "recipe"], matchPrefix: true },
  /* Bar stock, beside the Kitchen in the Restaurant menu (the owner's D27-354):
     the bar's daily sheet, its bills, its set up. */
  { section: "point-of-sale", order: 45, workingMenus: ["bar"],
    label: "Bar stock", to: "/pos/:code/bar-stock", icon: Wine, resource: "stock",
    keywords: ["bar register", "liquor", "nip", "pegs", "bar count", "bar bill"],
    canSee: (role) => BAR_STOCK.includes(role), module: "bar_stock" },
];
