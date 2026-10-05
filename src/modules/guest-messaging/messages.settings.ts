import { BellRing, FileText } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Settings → Messages (Settings phase 6; D27-252, D27-261, D27-280). The owner, an
   administrator and the GM (the console's default `setting`); the server asks
   again on every call. */
export const settingsPages: SettingsPage[] = [
  {
    group: "messages", slug: "switches", label: "Guest messages on/off", icon: BellRing, order: 40,
    keywords: ["whatsapp", "email", "reminder", "invoice", "voucher", "review", "confirmation"],
    load: () => import("./pages/MessageSwitches"),
  },
  {
    /* D27-280: each report On/Off and its own typed addresses, after the
       night audit. Replaced "Night audit reports" (D27-261), never released. */
    group: "messages", slug: "daily-report-emails", label: "Daily report emails", icon: FileText, order: 50,
    keywords: ["report", "email", "night audit", "manager report", "money owed", "ledger", "restaurant", "stock"],
    load: () => import("./pages/DailyReportEmails"),
  },
];
