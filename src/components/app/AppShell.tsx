import { Eye } from "lucide-react";
import { DEMO } from "@/lib/demo";
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
          {/* Said plainly, once, at the top. A reviewer who does not
              know this is a snapshot will read an unchanging occupancy
              figure as a bug, and a refused save as a broken button. */}
          {DEMO && (
            <div className="no-print shrink-0 flex items-center gap-2 px-4 py-2 bg-brand-yellow-50 border-b border-brand-yellow-100">
              <Eye className="size-4 text-[#8a6300] shrink-0" />
              <p className="text-sm text-[#8a6300]">
                <span className="font-semibold">Preview.</span>{" "}
                Real screens and real figures from the calibrated demo
                property — nothing saves, because there is no server behind
                this build yet.
              </p>
            </div>
          )}

          <main className="flex-1 overflow-y-auto scrollbar-quiet print:overflow-visible">
            <Outlet />
          </main>
        </div>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}