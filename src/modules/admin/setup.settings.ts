import { ListChecks } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* "Set up this hotel" in the Settings console (the owner's D27-311): the
   owner, an Admin and the GM - the console's own rule. Second in Property,
   after Profile, so the console still opens on Profile. The page is
   /settings/property/set-up-this-hotel; /h/:code/setup (the bell's link and
   "Back to setup") lands here, keeping ?step=. */
export const settingsPages: SettingsPage[] = [
  { group: "property", slug: "set-up-this-hotel", label: "Set up this hotel", icon: ListChecks, order: 15,
    keywords: ["setup", "set up", "wizard", "go live", "getting started", "new hotel", "checklist", "steps"],
    load: () => import("./setup/SetupPage") },
];
