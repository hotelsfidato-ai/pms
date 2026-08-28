import { NavLink, useLocation } from "react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { navigationFor, type NavItem } from "./navigation";
import { Tooltip } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   SIDEBAR
   Deep ink rail. Collapses to icons. Contents come from the role's
   permission set, so switching role visibly rebuilds it.
   ══════════════════════════════════════════════════════════════════ */

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const role = useUi((s) => s.role);
  const hotelId = useUi((s) => s.hotelId);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const location = useLocation();
  const sections = navigationFor(role, hotelId);

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
        {sections.map((section, i) => (
          <div key={section.label ?? `section-${i}`} className="mb-4 last:mb-0">
            {section.label && !collapsed && (
              <p className="px-2.5 mb-1.5 text-2xs font-semibold uppercase tracking-wider text-white/35">
                {section.label}
              </p>
            )}
            {section.label && collapsed && i > 0 && (
              <div className="h-px bg-white/8 mx-2 mb-3" />
            )}

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
          </div>
        ))}
      </nav>

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
        "flex items-center gap-2.5 h-9 rounded-md text-base font-medium",
        "transition-colors duration-150",
        collapsed ? "justify-center px-0" : "px-2.5",
        groupActive
          ? "bg-white/10 text-white"
          : "text-white/65 hover:text-white hover:bg-white/6",
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip content={item.label} side="right">
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