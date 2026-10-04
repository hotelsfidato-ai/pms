import { Store } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Settings → Modules and connections → Rivals' prices (D27-270). The owner,
   an administrator and the GM (the console's default `setting`); the server
   asks again on every call. In "connections" because it switches on an
   outside connection that spends paid searches, beside the channel manager. */
export const settingsPages: SettingsPage[] = [
  {
    group: "connections", slug: "rivals-prices", label: "Rivals' prices", icon: Store, order: 35,
    keywords: ["competitors", "competitor rates", "rate shopping", "nearby hotels", "Google Hotels", "SerpApi"],
    load: () => import("./pages/RivalsPrices"),
  },
];
