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
  {
    section: "system", order: 20,
    label: "Administration", to: "/admin/users", icon: Settings,
    resource: "user", matchPrefix: true,
    children: [
      /* ⚠ "PROPERTIES" WAS HERE TOO, POINTING AT /admin/properties.
         The two screens were merged on 9 September — /properties now
         adds, edits, closes and reopens, and /admin/properties
         renders it — so this was a second door onto one room, and
         the sidebar said "Properties" twice.

         The reasoning it carried is still true and now lives in the
         screen: everyone may READ the property list, and creating
         one is gated by `app.require_provisioning_key()` in the
         database, which no menu entry can grant or withhold. */
      { label: "Users", to: "/admin/users", icon: UserCog, resource: "user" },
      { label: "Roles and permissions", to: "/admin/roles", icon: ShieldCheck, resource: "role" },
      { label: "Integrations", to: "/admin/integrations", icon: Plug, resource: "integration" },
      { label: "Audit log", to: "/admin/audit-log", icon: ScrollText, resource: "audit_log" },
      { label: "Settings", to: "/admin/settings", icon: Settings, resource: "setting" },
      /* The console CREATES things — properties, people, access. It is
         the only screen in the system that manufactures a tenant, so it
         stays out of production builds until the group says otherwise. */
      {
        label: "Console", to: "/admin/console", icon: Terminal,
        resource: "hotel", devOnly: true,
        canSee: (role) => can(role, "create", "hotel"),
      },
    ],
  },
  /* D27-91: what the server is doing, for the owner and an administrator -
     exactly the roles that hold `role`, as the server asks (roleGate.ts). */
  { section: "system", order: 25,
    label: "System health", to: "/admin/system-health", icon: Activity, resource: "role",
    keywords: ["server", "telemetry", "uptime", "errors", "backup", "disk", "night audit"] },
];
