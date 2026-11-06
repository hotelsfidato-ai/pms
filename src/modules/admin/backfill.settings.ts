import { CalendarClock } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* "Backfill data" in the Settings console (the owner's D27-398): what
   happened before the hotel's first day. In Property, after "Set up this
   hotel" - it belongs to bringing a hotel onto the system (decided under
   D27-396). The owner, an Admin and the GM (the console's own `setting`);
   the Accountant, who has no Settings, reads the same page at
   /h/:code/backfill (nav.ts). The server asks again on every call. */
export const settingsPages: SettingsPage[] = [
  { group: "property", slug: "backfill-data", label: "Backfill data", icon: CalendarClock, order: 17,
    keywords: ["backfill", "before go live", "past days", "old bookings", "paper bills", "earlier stays", "history"],
    load: () => import("./backfill/BackfillPage") },
];
