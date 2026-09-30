import { Hotel, UserCog, Settings, ShieldCheck, Plug, ScrollText, Terminal, Activity } from "lucide-react";
import { can } from "@/lib/permissions";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Administration's menu entries — Across properties, and Administration
   under System. Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "across-properties", order: 10,
    label: "Properties", to: "/properties", icon: Hotel, resource: "hotel", matchPrefix: true },
  { section: "across-properties", order: 20,
    label: "People", to: "/people", icon: UserCog, resource: "user",
    keywords: ["staff", "users", "password", "team"], matchPrefix: true },
  /* D27-213, D27-214: ONE place for settings. "Settings" replaces
     Administration and its six children; everything they held is on a tab of
     it. Owner, Admin and GM (`setting`), as Settings and Configuration were. */
  { section: "system", order: 20,
    label: "Settings", to: "/settings", icon: Settings, resource: "setting", matchPrefix: true,
    keywords: ["configuration", "administration", "setup", "modules", "property profile", "address",
               "GSTIN", "check-in time", "check-out time", "front desk hours", "group name", "logo"] },
  /* The tab other screens point at by address (a refusal's "set it under…",
     the restaurant's checklist): an entry of its own, so the link is offered
     only to somebody who may open it, and Find a screen "GST" lands on it. */
  { section: "system", order: 21, listed: false,
    label: "Taxes and billing", to: "/settings/taxes-and-billing", icon: Settings, resource: "setting",
    keywords: ["GST", "VAT", "tax", "invoice series", "tax rules"] },
  /* Off the sidebar, on their Settings tab and in Find a screen - nothing
     lost (the owner's rule of 15 September, and D27-214). */
  { section: "system", order: 22, listed: false,
    label: "Users", to: "/admin/users", icon: UserCog, resource: "user" },
  { section: "system", order: 23, listed: false,
    label: "Roles and permissions", to: "/admin/roles", icon: ShieldCheck, resource: "role" },
  { section: "system", order: 24, listed: false,
    label: "Integrations", to: "/admin/integrations", icon: Plug, resource: "integration" },
  { section: "system", order: 26, listed: false,
    label: "Audit log", to: "/admin/audit-log", icon: ScrollText, resource: "audit_log" },
  /* The console CREATES things - properties, people, access. It is the only
     screen that manufactures a tenant, so it stays out of production builds. */
  { section: "system", order: 27, listed: false,
    label: "Console", to: "/admin/console", icon: Terminal,
    resource: "hotel", devOnly: true,
    canSee: (role) => can(role, "create", "hotel") },
  /* D27-91: what the server is doing, for the owner and an administrator -
     exactly the roles that hold `role`, as the server asks (roleGate.ts). */
  { section: "system", order: 25,
    label: "System health", to: "/admin/system-health", icon: Activity, resource: "role",
    keywords: ["server", "telemetry", "uptime", "errors", "backup", "disk", "night audit"] },
];
