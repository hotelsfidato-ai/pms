import { CalendarClock } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Settings → Messages → Scheduled reports (D27-383 item 5): any report by
   email after the night audit of its day, daily, weekly or monthly. Beside
   the daily report emails; the owner, an administrator and the GM (the
   console's default `setting`); the server asks again on every call. */
export const settingsPages: SettingsPage[] = [
  {
    group: "messages", slug: "scheduled-reports", label: "Scheduled reports", icon: CalendarClock, order: 60,
    keywords: ["report", "email", "weekly", "monthly", "schedule", "every week", "every month"],
    load: () => import("./pages/ScheduledReports"),
  },
];
