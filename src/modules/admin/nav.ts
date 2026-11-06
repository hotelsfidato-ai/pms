import { Hotel, UserCog, Settings, Plug, Terminal, Activity, CalendarClock } from "lucide-react";
import { can, canAccess } from "@/lib/permissions";
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
  /* D27-249: Settings is its own space, reached from the top bar's switcher,
     so it leaves the menu; its address and Find a screen stay. */
  { section: "system", order: 20, listed: false,
    label: "Settings", to: "/settings", icon: Settings, resource: "setting", matchPrefix: true,
    keywords: ["configuration", "administration", "setup", "modules", "property profile", "address",
               "GSTIN", "check-in time", "check-out time", "front desk hours", "group name", "logo",
               "FSSAI", "house policies", "office details", "Instagram", "reservations contact"] },
  /* "Rates and taxes" (/settings/taxes-and-billing) went with the tabs
     (D27-249): the console's Taxes and Bank details pages are in Find a
     screen under "GST" and "bank" (console.settings.ts), and the till's
     setup links the page itself. The old address redirects. */
  /* Off the sidebar, on their Settings tab and in Find a screen - nothing
     lost (the owner's rule of 15 September, and D27-214). */
  { section: "system", order: 22, listed: false,
    label: "Users", to: "/admin/users", icon: UserCog, resource: "user" },
  { section: "system", order: 24, listed: false,
    label: "Integrations", to: "/admin/integrations", icon: Plug, resource: "integration" },
  /* Roles and permissions, Audit log and Activity are the Settings console's
     (people.settings.ts, D27-255); their old addresses redirect there. */
  /* The console CREATES things - properties, people, access. It is the only
     screen that manufactures a tenant, so it stays out of production builds. */
  { section: "system", order: 27, listed: false,
    label: "Console", to: "/admin/console", icon: Terminal,
    resource: "hotel", devOnly: true,
    canSee: (role) => can(role, "create", "hotel") },
  /* D27-398: Backfill data is a Settings page (backfill.settings.ts). The
     Accountant reads it and has no Settings, so reads it here, from Find a
     screen: whoever reads it (`invoice` approve, as the server's read rule)
     and cannot open Settings. */
  { section: "finance", order: 90, listed: false,
    label: "Backfilled records", to: "/h/:code/backfill", icon: CalendarClock, resource: "invoice",
    keywords: ["backfill", "before go live", "past days", "paper bills"],
    canSee: (role) => can(role, "approve", "invoice") && !canAccess(role, "setting") },
  /* D27-91: what the server is doing, for the owner and an administrator -
     exactly the roles that hold `role`, as the server asks (roleGate.ts). */
  { section: "system", order: 25,
    label: "System health", to: "/admin/system-health", icon: Activity, resource: "role",
    keywords: ["server", "telemetry", "uptime", "errors", "backup", "disk", "night audit"] },
];
