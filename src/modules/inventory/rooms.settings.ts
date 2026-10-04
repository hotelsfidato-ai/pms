import { LayoutDashboard } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Rooms and rates in the settings console (P3; the owner's D27-258). The
   Room types page takes over P1's stand-in at the same group and slug; its
   old address redirects here (routes.tsx). */
export const settingsPages: SettingsPage[] = [
  { group: "rooms", slug: "room-types", label: "Room types", icon: LayoutDashboard, order: 10,
    resource: "room_config",
    keywords: ["rooms", "room setup", "beds", "view", "amenities", "photos", "adults", "children"],
    load: () => import("./pages/RoomSetup") },
];
