import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useUi } from "@/lib/ui";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
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

        {/* Main column */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="no-print contents">
            <TopBar />
          </div>
          {/* `overflow-y-auto` clips to the viewport, which on paper means
             ONE page and the rest silently gone. Released for print. */}
          <main className="flex-1 overflow-y-auto scrollbar-quiet print:overflow-visible">
            <Outlet />
          </main>
        </div>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}