import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { getModules } from "@/data/repositories";
import { navigationFor, sidebarFor, type NavItem } from "./navigation";

/* ══════════════════════════════════════════════════════════════════
   FIND A SCREEN — the other half of a shorter menu

   The top bar has said "Search or jump to…" with a ⌘K badge since the
   first checkpoint, and pressing it set a flag nothing read: there was
   no palette. That was harmless while the menu listed everything. It
   stopped being harmless on 15 September, when the owner chose shorter
   menus on the condition that nothing is lost — "off the menu, still
   findable by search". This is that search.

   It finds SCREENS: every one this person may open, listed in their
   menu or not. It does not search guests or bookings yet — the label
   says "Find a screen" so it promises only what it does.

   The retired words still work. Somebody who types "folio", "day end"
   or "floor" lands on Folios, Close restaurant day and Tables, because
   each entry carries the words people actually use (`keywords`).
   ══════════════════════════════════════════════════════════════════ */

interface Entry {
  item: NavItem;
  section: string;
  /** In this person's own menu. The rest are theirs to open, just not listed. */
  listed: boolean;
}

/** Every screen this role may open, in the navigation's order, once each. */
function entriesFor(role: Parameters<typeof navigationFor>[0], code: string, modules?: Record<string, boolean>): Entry[] {
  const listed = new Set(
    sidebarFor(role, code, modules).flatMap((s) =>
      s.items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]),
    ),
  );
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const section of navigationFor(role, code, modules)) {
    for (const item of section.items) {
      for (const entry of [item, ...(item.children ?? [])]) {
        if (seen.has(entry.to)) continue;
        seen.add(entry.to);
        out.push({ item: entry, section: section.label ?? "", listed: listed.has(entry.to) });
      }
    }
  }
  return out;
}

/** Closest first: the name itself, then its other words, then its section. */
function rank(entry: Entry, query: string): number {
  const label = entry.item.label.toLowerCase();
  const words = (entry.item.keywords ?? []).map((k) => k.toLowerCase());
  if (label.startsWith(query)) return 0;
  if (label.includes(query)) return 1;
  if (words.some((k) => k.startsWith(query))) return 2;
  if (words.some((k) => k.includes(query))) return 3;
  if (entry.section.toLowerCase().includes(query)) return 4;
  return -1;
}

export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const hotelId = useUi((s) => s.hotelId) ?? "";
  const role = useRole();
  const navigate = useNavigate();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  /* The same answer the sidebar uses, from the same cache entry. */
  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 5 * 60_000,
  });

  /* Ctrl K / ⌘K from anywhere — the badge in the top bar has promised it
     since the first checkpoint. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const entries = useMemo(
    () => entriesFor(role, hotelId, modules.data),
    [role, hotelId, modules.data],
  );

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return entries;
    return entries
      .map((entry) => ({ entry, score: rank(entry, q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.entry);
  }, [entries, q]);

  /* A new search starts at the top; the highlight never points past the end. */
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    navigate(entry.item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[2px] motion-fade" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[10vh] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2
                     overflow-hidden rounded-xl bg-white shadow-overlay"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Find a screen</DialogPrimitive.Title>

          <div className="flex items-center gap-2.5 px-4 h-14 border-b border-grey-200">
            <Search className="size-4 text-grey-400 shrink-0" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder="Find a screen - try “bill”, “night audit”, “stock”"
              aria-label="Find a screen"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 h-full bg-transparent text-md text-ink-900
                         placeholder:text-grey-400 outline-none"
            />
          </div>

          {results.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-base font-medium text-ink-900">No screen called that</p>
              <p className="text-sm text-grey-500 mt-1">
                Try a shorter word, or what a guest would call it.
              </p>
            </div>
          ) : (
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label="Screens"
              className="max-h-[min(60vh,26rem)] overflow-y-auto scrollbar-quiet p-1.5"
            >
              {results.map((entry, i) => {
                const Icon = entry.item.icon;
                return (
                  <li
                    key={entry.item.to}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(entry)}
                    className={cn(
                      "flex items-center gap-3 px-3 h-11 rounded-md cursor-pointer",
                      "transition-colors duration-100",
                      i === active ? "bg-grey-100" : "hover:bg-grey-50",
                    )}
                  >
                    <span className="grid place-items-center size-7 rounded-md bg-grey-100 text-grey-500 shrink-0">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex-1 min-w-0 truncate text-base text-ink-900">
                      {entry.item.label}
                    </span>
                    {/* Why it was not in the menu is worth knowing once:
                        it is theirs to open, just not listed for them. */}
                    {!entry.listed && (
                      <span className="text-2xs text-grey-500 shrink-0">Not in your menu</span>
                    )}
                    {entry.section && (
                      <span className="text-2xs text-grey-500 shrink-0 hidden sm:inline">
                        {entry.section}
                      </span>
                    )}
                    {i === active && (
                      <CornerDownLeft className="size-3.5 text-grey-400 shrink-0" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
