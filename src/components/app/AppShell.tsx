import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { OfflineBar } from "./OfflineBar";
import { CommandPalette } from "./CommandPalette";
import { PasswordDue } from "@/modules/admin";
import { Toaster, TooltipProvider } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   APP SHELL
   Fixed sidebar and top bar; the page scrolls inside. On tablet and
   below the sidebar becomes a drawer so the content keeps full width.
   ══════════════════════════════════════════════════════════════════ */

export function AppShell() {
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUi((s) => s.setMobileNavOpen);
  const { pathname } = useLocation();

  /* Safety net for a known Radix behaviour: a modal that unmounts while
     still open can leave `pointer-events: none` on <body>, which makes
     the entire application unclickable with no visible cause. On every
     route change, if nothing is actually open, clear the stale lock. */
  useEffect(() => {
    if (document.querySelector("[data-radix-focus-guard]")) return;
    if (document.body.style.pointerEvents === "none") {
      document.body.style.removeProperty("pointer-events");
    }
    document.body.removeAttribute("data-scroll-locked");
  }, [pathname]);

  /* THE BUSINESS DATE, re-read each time a screen opens (the owner, 28
     September). A device learned it at sign-in, so after the night audit
     on another desk this one went on showing yesterday. When it has moved,
     every list was computed for the old day: read them again. */
  const queryClient = useQueryClient();
  useEffect(() => {
    void useSession.getState().refreshDates().then((moved) => {
      if (moved) void queryClient.invalidateQueries();
    });
  }, [pathname, queryClient]);

  /* THE REMEMBERED HOTEL MUST BE ONE OF THIS PERSON'S (4 October). The
     browser keeps the last hotel, and the store starts on "5EL"; after the
     fresh start (D27-248) 5 Elements was gone from live, so Settings and
     every screen reading it asked for a hotel that does not exist and drew
     nothing. Once the person's hotels are known, a remembered hotel that is
     not among them becomes their first. */
  const hotels = useSession((s) => s.hotels);
  const remembered = useUi((s) => s.hotelId);
  const remember = useUi((s) => s.setHotelId);
  useEffect(() => {
    const first = hotels[0];
    if (first && !hotels.some((h) => h.code === remembered || h.id === remembered)) {
      remember(first.code);
    }
  }, [hotels, remembered, remember]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen overflow-hidden bg-grey-50 print:block print:h-auto print:overflow-visible">
        {/* Desktop rail. `no-print` because a printed tax invoice with a
            navigation sidebar down its left edge is not a tax invoice —
            and the invoice page cannot hide the shell from inside it. */}
        <div className="hidden lg:block no-print">
          <Sidebar />
        </div>

        {/* Tablet / mobile drawer */}
        <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[2px] motion-fade lg:hidden" />
            <DialogPrimitive.Content className="fixed left-0 top-0 z-50 h-full motion-drawer-left lg:hidden">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Main application navigation
              </DialogPrimitive.Description>
              <Sidebar onNavigate={() => setMobileNavOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* "Find a screen". Opened by the top bar and by Ctrl K. */}
        <CommandPalette />

        {/* Main column */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="no-print contents">
            <TopBar />
          </div>
          {/* `overflow-y-auto` clips to the viewport, which on paper means
             ONE page and the rest silently gone. Released for print. */}
          {/* `relative`, and it is not cosmetic. An absolutely positioned
              element is clipped only by an ancestor that is its CONTAINING
              BLOCK, and a static ancestor's `overflow` does not apply to it.
              `main` was static, so every `sr-only` label on the page — they
              are `position: absolute` by definition — anchored to the page
              itself and escaped the shell's `overflow-hidden`.

              On Housekeeping, with one per room card down a long grid, the
              furthest sat at 1662px in a 900px window. The DOCUMENT then
              scrolled, which drags the sidebar off the top of the screen:
              the menu slides away and the whole thing looks unmoored. Every
              other page was fine, which is what made it look like a
              Housekeeping bug rather than a shell one.

              Anchoring them here fixes the class of fault, not the instance. */}
          <main className="relative flex-1 overflow-y-auto scrollbar-quiet print:overflow-visible">
            {/* INSIDE the scroll region and sticky, so it rides the top
                of whatever screen is open rather than pushing the whole
                shell down. Held work belongs to the person, not to the
                page they happen to be on. Hidden when printing: an
                invoice does not carry the desk's sync state. */}
            <div className="print:hidden"><OfflineBar /></div>
            <Outlet />
            <PasswordDue />
          </main>
        </div>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}