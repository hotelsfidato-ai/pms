import { BellRing, FileText } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Settings → Messages (Settings phase 6; D27-252, D27-261). The owner, an
   administrator and the GM (the console's default `setting`); the server asks
   again on every call. */
export const settingsPages: SettingsPage[] = [
  {
    group: "messages", slug: "switches", label: "Guest messages on/off", icon: BellRing, order: 40,
    keywords: ["whatsapp", "email", "reminder", "invoice", "voucher", "review", "confirmation"],
    load: () => import("./pages/MessageSwitches"),
  },
  {
    group: "messages", slug: "night-audit-reports", label: "Reports after the night audit", icon: FileText, order: 50,
    keywords: ["report", "email", "night audit", "manager summary", "city ledger"],
    load: () => import("./pages/NightAuditReports"),
  },
];
