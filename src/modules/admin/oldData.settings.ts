import { FileUp } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";
import { switchesModules } from "./moduleSwitchRoles";

/* "Bring in old data" in the Settings console (D27-383 item 7): an old
   system's guests, bookings to come and past stays, from a file. In
   Property, after "Backfill data" - it belongs to bringing a hotel onto the
   system (decided under D27-396). The owner and an Admin only, the module
   switches' pair; the server asks again on every call (app.imports_old_data). */
export const settingsPages: SettingsPage[] = [
  { group: "property", slug: "old-data", label: "Bring in old data", icon: FileUp, order: 18,
    canSee: switchesModules,
    keywords: ["import", "old system", "old PMS", "IDS", "WinHMS", "eZee", "spreadsheet", "Excel", "CSV",
               "guest list", "future bookings", "past stays", "migrate", "onboard"],
    load: () => import("./oldData/OldDataPage") },
];
