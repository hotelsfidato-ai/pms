import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { NotificationBell } from "./NotificationBell";
import { AccountMenu } from "./AccountMenu";
import { BusinessDateBehind } from "./BusinessDateBehind";

/* ══════════════════════════════════════════════════════════════════
   TOP BAR
   Search, notifications, the role switcher. Nothing else earns a
   place up here — create actions belong to the page header, where
   they sit beside the other actions for that screen.
   ══════════════════════════════════════════════════════════════════ */

/* The desk runs Windows; the badge said ⌘K, a key those keyboards do not
   have. Ctrl K works on both, and the palette listens for either. */
const SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

export function TopBar() {
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const setMobileNavOpen = useUi((s) => s.setMobileNavOpen);


  return (
    <>
    <header className="flex items-center gap-3 h-14 px-4 sm:px-5 bg-white border-b border-grey-200 shrink-0">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        /* 44px. It was p-1.5, which rendered 32 — the smallest target in
           the application, on the one control every phone user reaches
           for first. The negative margin keeps it optically aligned with
           the page content despite the larger hit area. */
        className="lg:hidden size-11 -ml-2.5 grid place-items-center rounded-md text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {/* Opens "Find a screen". It said "Search or jump to a record" and
          opened nothing at all until 15 September; it finds screens, not
          records, so it says screens. */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        /* Collapses to an icon below `sm`, so it needs its own name. */
        aria-label="Find a screen"
        className={cn(
          /* 44 where a finger uses it, 36 on the desktop console where a
             mouse does and the header should stay compact. */
          "flex items-center gap-2.5 h-11 lg:h-9 px-3 rounded-md min-w-0",
          "sm:border sm:border-grey-300 bg-white text-grey-500",
          "hover:border-grey-400 transition-colors duration-150",
          "w-11 sm:w-64 lg:w-80 justify-center sm:justify-start",
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden sm:block text-base truncate">Find a screen…</span>
        <kbd className="hidden lg:inline-flex items-center h-5 px-1.5 ml-auto rounded-sm bg-grey-100 text-2xs font-medium text-grey-600">
          {SHORTCUT}
        </kbd>
      </button>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* No create action here. Every screen where raising a booking is
            the natural next step already offers it in its page header, at
            every width — putting one here too would place two primary
            buttons on the same view. ⌘K covers the global path. */}
        {/* THE AI BUTTON IS GONE. It was labelled "Open AI assistant" and
            called setMobileNavOpen — its own comment said the panel had
            been dropped — so it opened the navigation drawer instead. A
            control that does something other than what it says is worse
            than no control: somebody presses it, gets the nav, and learns
            not to trust the header. It comes back when there is a panel
            behind it. */}

        <NotificationBell />

        <div className="w-px h-6 bg-grey-200 mx-1" />

        <AccountMenu />
      </div>
    </header>
    {/* D27-237: one line while the business date is behind today. */}
    <BusinessDateBehind />
    </>
  );
}