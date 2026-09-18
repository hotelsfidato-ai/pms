import { ShoppingCart } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Purchasing — BUILT (phase 2C, docs/BUILD-PLAN-2026-09-18.md § 1). Its
   entry left the Coming soon section and took its place in "Store and
   equipment", beside the Store and the Equipment register it buys for —
   the place navigation.ts always said it would go.

   WHO SEES IT is `resource: "purchasing"` in src/lib/permissions.ts, which
   has held a column for this service since before it existed: the owner, an
   administrator, the GM, the hotel manager, the kitchen manager, the
   Inventory Manager, the accountant and a viewer. That is who may LOOK.
   Who may RAISE a request is a different question and a different answer —
   a setting per property (D18-2), asked of the server, never of a menu.

   ⚠ IN THE INVENTORY MANAGER'S WORKING MENU. They are the first name on
   D18-2's default list and this is their own screen; without the entry the
   one person the service is for could reach it only by searching. The
   kitchen manager is deliberately NOT here: they are switched on by the
   owner when the owner wants them, and until then the entry would be a
   screen that refuses them.

   The setting's own screen is `listed: false` — it is reached from the
   Purchasing screen, and it is not a fourth thing in the sidebar. It stays
   findable by search, under the words somebody would type for it. */
export const nav: ServiceNavEntry[] = [
  { section: "store-and-equipment", order: 40,
    label: "Purchasing", to: "/h/:code/purchasing", icon: ShoppingCart,
    resource: "purchasing", matchPrefix: true, workingMenus: ["stores"],
    keywords: ["purchase", "order", "supplier", "buy", "requisition", "po", "delivery"] },
  { section: "store-and-equipment", order: 41,
    label: "Who may ask to buy", to: "/h/:code/purchasing/who-may-ask",
    icon: ShoppingCart, resource: "purchasing", listed: false,
    keywords: ["purchase setting", "who may raise", "requester", "permission to buy"] },
];
