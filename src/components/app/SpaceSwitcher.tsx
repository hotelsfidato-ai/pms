import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { getModules } from "@/data/repositories";
import { sidebarFor, spaceOf, spacesFor, type Space } from "./navigation";

/* ══════════════════════════════════════════════════════════════════
   THE SPACE SWITCHER (D27-249, D27-256): Front office · Restaurant ·
   Settings. In the top bar from 640px; on a phone at the top of the menu
   drawer (Q5). Drawn only for somebody with two spaces or more - the
   waiter, the chef and the kitchen manager have the Restaurant alone.
   ══════════════════════════════════════════════════════════════════ */

const NAMES: Record<Space, string> = { front: "Front office", pos: "Restaurant", settings: "Settings" };

export function SpaceSwitcher({ dark, className, onNavigate }: {
  /** On the navy menu drawer. */
  dark?: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  const role = useRole();
  const hotelId = useUi((s) => s.hotelId);
  const { pathname } = useLocation();
  /* The sidebar's own read, so the two never disagree. */
  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 5 * 60_000,
  });
  const spaces = spacesFor(role, hotelId, modules.data);
  if (spaces.length < 2) return null;
  const here = spaceOf(pathname);
  /* Where each one opens: the Dashboard, the top of the Restaurant's menu,
     the console's first page. */
  const home = (space: Space) => space === "front" ? "/"
    : space === "settings" ? "/settings"
    : sidebarFor(role, hotelId, modules.data, "pos")[0]?.items[0]?.to ?? "/";

  return (
    <nav aria-label="Spaces"
      className={cn("flex rounded-full p-0.5", dark ? "bg-white/8" : "bg-grey-100", className)}>
      {spaces.map((space) => (
        <Link key={space} to={home(space)} onClick={onNavigate}
          aria-current={space === here ? "page" : undefined}
          className={cn(
            "flex-1 flex items-center justify-center whitespace-nowrap rounded-full px-3 font-medium",
            "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-brand-orange",
            dark ? "h-11 text-sm" : "h-8 text-sm",
            space === here
              ? (dark ? "bg-white text-ink-900" : "bg-white text-ink-900 shadow-sm")
              : (dark ? "text-white/70 hover:text-white" : "text-grey-600 hover:text-ink-900"),
          )}>
          {NAMES[space]}
        </Link>
      ))}
    </nav>
  );
}
