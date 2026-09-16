import { Armchair } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Equipment — the register of durable things in the hotel, the restaurant
   and the rooms (decision S2, 16 September; phase 1B). Assembled by
   `navigation.ts`, in the Store and equipment section after the Store.

   RESOURCE `equipment`: everybody holding any grant on it sees the entry
   — owner, admin, GM, hotel manager, Inventory Manager, kitchen manager, chef,
   housekeeping, reception, accountant, viewer. The revenue manager and
   the till operator hold none.

   WORKING MENUS. The Inventory Manager's (`stores`, S13) and Housekeeping's
   (the owner's answer, 16 September; added by the master at the merge). Both
   are pinned in `navigation.test.ts`.

   Was a Coming soon page meaning door locks and room phones; those moved
   to Room systems. */
export const nav: ServiceNavEntry[] = [
  { section: "store-and-equipment", order: 20, workingMenus: ["stores", "housekeeping"],
    label: "Equipment", to: "/h/:code/equipment", icon: Armchair, resource: "equipment",
    matchPrefix: true,
    keywords: ["asset", "register", "repair", "warranty", "amc", "furniture", "appliance",
               "ac", "tv", "fridge", "kettle"] },
];
