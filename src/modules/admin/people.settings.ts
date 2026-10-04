import { ShieldCheck, ScrollText, History, LogIn } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* The Settings console's People and security pages (phase 7, D27-249 to
   D27-255). People itself stays phase 1's link to the Front office screen
   (the hotel manager needs it). Each label is its page's PageHeader title. */
export const settingsPages: SettingsPage[] = [
  { group: "people", slug: "roles", label: "Roles and permissions", icon: ShieldCheck, order: 20,
    resource: "role", keywords: ["permissions", "what each role may do"],
    load: () => import("./pages/Admin").then((m) => ({ default: m.RolesPage })) },
  { group: "people", slug: "audit-log", label: "Audit log", icon: ScrollText, order: 30,
    resource: "audit_log", keywords: ["charges", "payments", "reversals"],
    load: () => import("./pages/Admin").then((m) => ({ default: m.AuditLogPage })) },
  { group: "people", slug: "activity", label: "Activity", icon: History, order: 40,
    resource: "audit_log", keywords: ["changes", "who changed", "history", "activity log"],
    load: () => import("./pages/Activity") },
  /* D27-255: replaces the Sign-ins stand-in; /admin/sign-ins redirects here. */
  { group: "people", slug: "devices", label: "Sign-ins and devices", icon: LogIn, order: 50,
    resource: "user", canSee: (role) => role === "owner" || role === "admin",
    keywords: ["sign-in history", "devices", "sign out", "logins", "security"],
    load: () => import("./pages/SignIns") },
];
