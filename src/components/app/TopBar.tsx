import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { canAccess } from "@/lib/permissions";
import { NotificationBell } from "./NotificationBell";
import { AccountMenu } from "./AccountMenu";

/* ══════════════════════════════════════════════════════════════════
   TOP BAR
   Search, notifications, the role switcher. Nothing else earns a
   place up here — create actions belong to the page header, where
   they sit beside the other actions for that screen.
   ══════════════════════════════════════════════════════════════════ */

export function TopBar() {
  const role = useRole();
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const setMobileNavOpen = useUi((s) => s.setMobileNavOpen);

  const canUseAi = canAccess(role, "ai");

  return (
    <header className="flex items-center gap-3 h-14 px-4 sm:px-5 bg-white border-b border-grey-200 shrink-0">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden p-1.5 -ml-1.5 rounded-md text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {/* Search opens the palette rather than being a second search box. */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        /* Collapses to an icon below `sm`, so it needs its own name. */
        aria-label="Search or jump to a record"
        className={cn(
          "flex items-center gap-2.5 h-9 px-3 rounded-md min-w-0",
          "border border-grey-200 bg-grey-50 text-grey-400",
          "hover:bg-white hover:border-grey-300 transition-colors duration-150",
          "w-9 sm:w-64 lg:w-80 justify-center sm:justify-start",
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden sm:block text-base truncate">Search or jump to…</span>
        <kbd className="hidden lg:inline-flex items-center h-5 px-1.5 ml-auto rounded-xs bg-white border border-grey-200 text-2xs font-medium text-grey-500">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* No create action here. Every screen where raising a booking is
            the natural next step already offers it in its page header, at
            every width — putting one here too would place two primary
            buttons on the same view. ⌘K covers the global path. */}
        {canUseAi && (
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)} // Placeholder - AI panel dropped
            className="p-2 rounded-md text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
            aria-label="Open AI assistant"
            title="AI assistant"
          >
            <Search className="size-[18px]" />
          </button>
        )}

        <NotificationBell />

        <div className="w-px h-6 bg-grey-200 mx-1" />

        <AccountMenu />
      </div>
    </header>
  );
}