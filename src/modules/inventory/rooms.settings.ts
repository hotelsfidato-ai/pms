import { LayoutDashboard, Network, UtensilsCrossed } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Rooms and rates in the settings console (P3; the owner's D27-258). The
   Room types page takes over P1's stand-in at the same group and slug; its
   old address redirects here (routes.tsx). */
export const settingsPages: SettingsPage[] = [
  { group: "rooms", slug: "room-types", label: "Room types", icon: LayoutDashboard, order: 10,
    resource: "room_config",
    keywords: ["rooms", "room setup", "beds", "view", "amenities", "photos", "adults", "children"],
    load: () => import("./pages/RoomSetup") },
  /* D27-251: the rate plans as a tree over the one pricing. */
  { group: "rates", slug: "plans", label: "Rate plans", icon: Network, order: 15, resource: "rate",
    keywords: ["master", "derived", "independent", "rate plan", "meal plan", "channels", "sources"],
    load: () => import("./pages/RatePlans") },
  { group: "rates", slug: "meal-plans", label: "Meal plans", icon: UtensilsCrossed, order: 18, resource: "rate",
    keywords: ["breakfast", "dinner", "CP", "MAP", "AP", "AI", "meals by day"],
    load: () => import("./pages/MealPlans") },
];
