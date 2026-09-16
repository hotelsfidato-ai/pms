import { LayoutDashboard, Wallet, ShieldAlert, Table2, BarChart3, IndianRupee } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { setsRates } from "@/lib/permissions";

/* Inventory and rates — how this hotel is set up to sell (Configuration)
   and what it is selling today (Inventory). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "configuration", order: 10,
    label: "Room types", to: "/h/:code/room-types", icon: LayoutDashboard, resource: "room_config" },
  { section: "configuration", order: 20,
    label: "Rate plans", to: "/h/:code/rate-plans", icon: Wallet, resource: "rate",
    keywords: ["price", "tariff", "rates"] },
  { section: "configuration", order: 30,
    label: "Cancellation terms", to: "/h/:code/cancellation-terms", icon: ShieldAlert, resource: "rate" },
  { section: "inventory", order: 5,
    label: "Pricing", to: "/h/:code/pricing", icon: IndianRupee, resource: "rate",
    /* Not everybody who may READ a price may move one. `rate: READ` is
       reception's grant, and this screen changes every price in the property
       at once — see RATE_SETTER_ROLES. The route guard asks the navigation,
       so this line closes the door as well as hiding it. */
    canSee: setsRates,
    keywords: ["base price", "difference", "dynamic", "tariff", "calendar"] },
  { section: "inventory", order: 10,
    label: "Rate calendar", to: "/h/:code/grids", icon: Table2, resource: "rate",
    keywords: ["prices by day", "grid"] },
  { section: "inventory", order: 20,
    label: "Rate performance", to: "/h/:code/rates", icon: BarChart3, resource: "rate" },
];
