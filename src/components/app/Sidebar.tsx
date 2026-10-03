import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router";
import { ArrowLeft, ArrowUpRight, ChevronDown, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { navigationFor, sidebarFor, spaceOf, spacesFor, type NavItem } from "./navigation";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { Tooltip } from "@/components/ui";
import { getModules } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   SIDEBAR
   Deep ink rail. Collapses to icons. Contents come from the role's
   permission set, so switching role visibly rebuilds it.
   ══════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════════
   WHICH SECTIONS OPEN BY THEMSELVES — the owner's call, 19 September

   Their words: keep the main things as default and let the rest be a
   toggle. So the work of running a hotel stays open and everything a
   property may not even have folds away: the spa, the laundry, the
   banquet, the point of sale, reports and system. So do the two
   sections that hold only services not built yet, Sales and marketing
   and Distribution (D27-87, 28 September): take a key out of this list
   the day its section holds a built screen.

   ⚠ NOT A PERMISSION, AND NOT A HIDING PLACE. A folded section is
   still in the menu, still found by "Find a screen", and still reached
   by its address. This only decides how much of the rail a person is
   looking at before they touch anything.

   ⚠ AND A SECTION HOLDING THE SCREEN YOU ARE ON IS NEVER FOLDED. You
   cannot end up on a page whose own place in the menu is hidden from
   you — that is how somebody loses their bearings entirely.

   A section not named here opens. That is deliberate: a service built
   next month appears where somebody can see it, rather than folded
   away by a default nobody wrote. */
const FOLDED_AS_IT_COMES = new Set([
  "point-of-sale", "banquet", "laundry", "spa", "reports", "system",
  "sales-marketing", "distribution",
]);

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const role = useRole();
  const hotelId = useUi((s) => s.hotelId);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const folded = useUi((s) => s.foldedSections);
  const toggleSection = useUi((s) => s.toggleSection);
  const location = useLocation();
  /* Undefined until it answers, and navigationFor keeps a section while
     the answer is unknown — hiding it and showing it a moment later makes
     the sidebar jump under somebody's cursor. */
  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 5 * 60_000,
  });

  /* WHAT THIS PERSON WORKS FROM (the clarity plan, step 3) — not
     everything they are allowed. The rest is one search away, and the
     button at the foot of the menu says so. */
  /* THE SPACE'S OWN MENU (D27-249): the address says which, among the ones
     this person has; somebody with one space always sees its menu. */
  const spaces = spacesFor(role, hotelId, modules.data);
  const here = spaceOf(location.pathname);
  const space = spaces.includes(here) ? here : spaces[0]!;
  const sections = sidebarFor(role, hotelId, modules.data, space);
  const hidden =
    navigationFor(role, hotelId, modules.data).reduce(
      (n, s) => n + s.items.reduce((m, i) => m + 1 + (i.children?.length ?? 0), 0), 0)
    - sections.reduce(
      (n, s) => n + s.items.reduce((m, i) => m + 1 + (i.children?.length ?? 0), 0), 0);
  const setCommandOpen = useUi((s) => s.setCommandOpen);

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-ink-900 text-white shrink-0",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex items-center h-14 shrink-0 border-b border-white/8",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        {collapsed ? (
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-auto"
          >
            <rect width="28" height="28" rx="6" fill="#0B0B0C" />
            <path
              d="M14 7L19.5 14L14 21"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg
            width="140"
            height="28"
            viewBox="0 0 140 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-auto brightness-0 invert opacity-95"
          >
            <text
              x="0"
              y="20"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="20"
              fontWeight="600"
              fill="#0B0B0C"
            >
              Fidato Hotels
            </text>
          </svg>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-quiet py-3 px-2.5">
        {/* On a phone the switcher is here, at the top of the drawer (Q5). */}
        {onNavigate && <SpaceSwitcher dark className="sm:hidden mb-4" onNavigate={onNavigate} />}
        {space === "settings" && (
          <ul className="mb-4">
            <SidebarItem
              item={{ label: "Back to front office", to: "/", icon: ArrowLeft, resource: "dashboard" }}
              collapsed={collapsed} currentPath={location.pathname} onNavigate={onNavigate} />
          </ul>
        )}
        {sections.map((section, i) => {
          const key = section.key ?? section.label ?? `section-${i}`;
          /* The section holding the screen in view is never folded. */
          const holdsCurrent = section.items.some((it) =>
            location.pathname === it.to ||
            (it.matchPrefix && location.pathname.startsWith(it.to.split(":")[0]!)));
          /* Only the Front office folds: the Restaurant and the console are
             short menus that are all the work of their space. */
          const asItComes = space === "front" && FOLDED_AS_IT_COMES.has(key);
          const isFolded = !collapsed && !holdsCurrent && section.label
            ? (folded[key] ?? asItComes)
            : false;

          return (
            <div key={key} className="mb-4 last:mb-0">
              {section.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleSection(key)}
                  aria-expanded={!isFolded}
                  className="w-full flex items-center gap-1 px-2.5 mb-1.5 text-2xs
                             font-semibold uppercase tracking-wider text-white/35
                             hover:text-white/60 focus-visible:outline-none
                             focus-visible:ring-1 focus-visible:ring-white/40 rounded"
                >
                  <ChevronDown
                    className={cn("h-3 w-3 shrink-0 transition-transform",
                      isFolded && "-rotate-90")}
                    aria-hidden
                  />
                  <span>{section.label}</span>
                  {/* How many are folded away, so a closed section never
                      reads as an empty one. */}
                  {isFolded && (
                    <span className="ml-auto tabular-nums text-white/25">
                      {section.items.length}
                    </span>
                  )}
                </button>
              )}
              {section.label && collapsed && i > 0 && (
                <div className="h-px bg-white/8 mx-2 mb-3" />
              )}

              {!isFolded && (
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <SidebarItem
                      key={`${section.label ?? "top"}-${item.label}-${item.to}`}
                      item={item}
                      collapsed={collapsed}
                      currentPath={location.pathname}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* The way to everything not listed above. Shown whenever the menu
          leaves something out, so a shorter menu never reads as "that
          screen does not exist". */}
      {hidden > 0 && (
        <div className="shrink-0 border-t border-white/8 px-2.5 pt-2.5">
          <button
            type="button"
            onClick={() => { onNavigate?.(); setCommandOpen(true); }}
            className={cn(
              "flex items-center gap-2.5 w-full h-9 rounded-md",
              "text-sm text-white/70 hover:text-white hover:bg-white/8",
              "transition-colors duration-150",
              collapsed ? "justify-center px-0" : "px-2.5",
            )}
            aria-label="Find a screen that is not in your menu"
          >
            <Search className="size-4" />
            {!collapsed && <span>Find a screen</span>}
          </button>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-white/8 p-2.5">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex items-center gap-2.5 w-full h-9 rounded-md",
            "text-sm text-white/55 hover:text-white hover:bg-white/8",
            "transition-colors duration-150",
            collapsed ? "justify-center px-0" : "px-2.5",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({
  item, collapsed, currentPath, onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  const isActive = item.matchPrefix
    ? currentPath === item.to || currentPath.startsWith(`${item.to}/`)
    : currentPath === item.to;

  // A parent is "open" when the current route sits inside its group.
  const childActive = item.children?.some(
    (child) => currentPath === child.to || currentPath.startsWith(`${child.to}/`),
  );
  const groupActive = isActive || childActive;

  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md text-base font-medium",
        /* A service not built yet takes a second line for its mark
           (D27-87), so its name is never cut to fit it. */
        item.notBuilt && !collapsed ? "min-h-9 py-1.5" : "h-9",
        "transition-colors duration-150",
        collapsed ? "justify-center px-0" : "px-2.5",
        groupActive
          ? "bg-white/10 text-white"
          : "text-white/65 hover:text-white hover:bg-white/6",
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && (item.notBuilt ? (
        <span className="min-w-0">
          <span className="block truncate">{item.label}</span>
          <span className="block text-xs font-normal text-white/45">Not built yet</span>
        </span>
      ) : (
        <span className="truncate">{item.label}</span>
      ))}
      {/* A console link to a Front office screen: it leaves the console. */}
      {item.leaves && !collapsed && (
        <>
          <ArrowUpRight className="size-3.5 shrink-0 ml-auto text-white/40" aria-hidden />
          <span className="sr-only">(opens in Front office)</span>
        </>
      )}
    </NavLink>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip content={item.notBuilt ? `${item.label} · Not built yet` : item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}

      {/* Sub-navigation only unfolds for the section you're actually in. */}
      {!collapsed && groupActive && item.children && item.children.length > 0 && (
        <ul className="mt-0.5 mb-1 ml-[19px] pl-3 border-l border-white/10 space-y-0.5">
          {item.children.map((child) => {
            const active =
              currentPath === child.to ||
              (child.to !== item.to && currentPath.startsWith(`${child.to}/`));
            return (
              <li key={`${child.label}-${child.to}`}>
                <NavLink
                  to={child.to}
                  onClick={onNavigate}
                  end={child.to === item.to}
                  className={cn(
                    "flex items-center h-8 px-2.5 rounded-md text-sm",
                    "transition-colors duration-150",
                    active
                      ? "text-white bg-white/8"
                      : "text-white/50 hover:text-white/90 hover:bg-white/5",
                  )}
                >
                  {child.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}