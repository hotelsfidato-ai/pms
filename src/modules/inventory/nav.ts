import { ShieldAlert, IndianRupee, Tags } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { setsRates } from "@/lib/permissions";
import { hotelsWhere } from "@/modules/reports";

/* Inventory and rates — how this hotel is set up to sell (Configuration)
   and what it is selling today (Rooms and rates). Assembled by
   `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "configuration", order: 30,
    label: "Cancellation terms", to: "/h/:code/cancellation-terms", icon: ShieldAlert, resource: "rate" },
  /* D27-188, D27-194: one screen replaces Pricing, Rate plans, the Rate
     calendar and Rate performance. Everyone with `rate: READ` sees it; the
     screen and the server let only RATE_SETTER_ROLES change a price. The
     old names stay as words Find a screen understands. */
  { section: "inventory", order: 5,
    label: "Rates", to: "/h/:code/rates", icon: IndianRupee, resource: "rate",
    keywords: ["price", "tariff", "pricing", "rate plans", "rate calendar",
               "rate performance", "base price", "add-ons", "breakfast",
               "extra adult", "occupancy", "ADR", "stop sell", "restrictions"] },
  /* One price change at several properties (D27-383 item 6): for whoever
     sets prices at more than one real property - the owner, or a revenue
     manager over two. */
  { section: "across-properties", order: 8,
    label: "Group rate change", to: "/group-rates", icon: Tags, resource: "rate",
    canSee: (role) => setsRates(role) && hotelsWhere(setsRates).length > 1,
    keywords: ["change prices at every property", "rates across properties", "group price", "raise prices", "lower prices"] },
];
