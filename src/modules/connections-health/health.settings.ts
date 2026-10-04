import { HeartPulse } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Settings → Modules and connections → Connection health (D27-276). The
   owner, an administrator and the GM (the console's default `setting`); the
   server asks again on every call. */
export const settingsPages: SettingsPage[] = [
  {
    group: "connections", slug: "connection-health", label: "Connection health", icon: HeartPulse, order: 45,
    keywords: ["n8n", "WhatsApp", "Meta", "CRS", "Firebase", "backups", "alerts", "outside connections", "status"],
    load: () => import("./pages/ConnectionHealth"),
  },
];
