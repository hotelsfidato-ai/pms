import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarDays, CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getModules, queryKeys, type Stay } from "@/data/repositories";
import { listStays, STAY_LABEL } from "@/modules/front-desk";
import { navigationFor, sidebarFor, spacesFor, type NavItem } from "./navigation";

/* ══════════════════════════════════════════════════════════════════
   FIND A SCREEN — the other half of a shorter menu

   The top bar has said "Search or jump to…" with a ⌘K badge since the
   first checkpoint, and pressing it set a flag nothing read: there was
   no palette. That was harmless while the menu listed everything. It
   stopped being harmless on 15 September, when the owner chose shorter
   menus on the condition that nothing is lost — "off the menu, still
   findable by search". This is that search.

   It finds SCREENS: every one this person may open, listed in their
   menu or not. Since D27-239 it also finds GUESTS AND BOOKINGS, for a
   role that sees bookings (the owner's answers of 2 October): from three
   letters, or four digits of a phone, the bookings whose guest, reference
   or phone match - under the screens, in house first, at most eight, each
   opening on All bookings (?res=). A guest has no page of their own, so a
   guest is found as their bookings. The read is All bookings' own
   (GET /stays, the same cache entry); a phone matches only for a role
   that also sees guests, as the server's WITHHELD blanks it for the rest.
   ponytail: the whole list is read, as All bookings reads it; a server
   search with its own gate line when a hotel's list gets slow.

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
  /* In the menu of any space this person has (D27-249). */
  const listed = new Set(
    spacesFor(role, code, modules).flatMap((space) => sidebarFor(role, code, modules, space)).flatMap((s) =>
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
        /* A console group says it is Settings': "Front desk" is a section of the
           Front office too. */
        const name = section.space === "settings" ? `Settings · ${section.label}` : section.label ?? "";
        out.push({ item: entry, section: name, listed: listed.has(entry.to) });
      }
    }
  }
  return out;
}

/** In the house, then coming, then gone. */
const when = (s: Stay) =>
  s.status === "in-house" || s.status === "due-out" ? 0
    : s.status === "due-in" || s.status === "tentative" ? 1 : 2;

/** The bookings a search finds: from 3 characters by guest or reference, or
    by 4 digits of a phone where `phones` (a role that sees guests). In the
    house first, then coming (soonest first), then gone (newest first). */
export function findBookings(stays: Stay[], query: string, phones: boolean): Stay[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return stays
    .filter((s) =>
      (q.length >= 3 && (s.guest.toLowerCase().includes(q) || s.reference.toLowerCase().includes(q)))
      || (phones && digits.length >= 4 && (s.phone ?? "").replace(/\D/g, "").includes(digits)))
    .sort((a, b) => when(a) - when(b)
      || (when(a) === 2 ? b.arrival.localeCompare(a.arrival) : a.arrival.localeCompare(b.arrival)))
    .slice(0, 8);
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

  /* Guests and bookings, for a role that sees bookings (D27-239). */
  const seesBookings = can(role, "view", "reservation");
  const typed = query.trim().toLowerCase();
  const asks = seesBookings && (typed.length >= 3 || typed.replace(/\D/g, "").length >= 4);
  const stays = useQuery({
    queryKey: queryKeys.stays(hotelId, "book"),
    queryFn: () => listStays(hotelId),
    enabled: open && asks && Boolean(hotelId),
    staleTime: 60_000,
  });
  const found = useMemo(
    () => (asks && stays.data ? findBookings(stays.data, typed, can(role, "view", "customer")) : []),
    [asks, stays.data, typed, role],
  );

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
  /* A booking opens in All bookings' own panel. */
  const open_ = (stay: Stay) => {
    close();
    navigate(`/h/${hotelId}/reservations?res=${stay.id}`);
  };
  const count = results.length + found.length;
  const pick = (i: number) => (i < results.length ? go(results[i]) : found[i - results.length] && open_(found[i - results.length]!));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
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
          <DialogPrimitive.Title className="sr-only">
            {seesBookings ? "Find a screen, a guest or a booking" : "Find a screen"}
          </DialogPrimitive.Title>

          <div className="flex items-center gap-2.5 px-4 h-14 border-b border-grey-200">
            <Search className="size-4 text-grey-400 shrink-0" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder={seesBookings ? "Find a screen, a guest or a booking"
                : "Find a screen - try “bill”, “night audit”, “stock”"}
              aria-label="Find a screen"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={active < count ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 h-full bg-transparent text-md text-ink-900
                         placeholder:text-grey-400 outline-none"
            />
          </div>

          {count === 0 ? (stays.isFetching ? null : (
            <div className="px-5 py-10 text-center">
              <p className="text-base font-medium text-ink-900">
                {seesBookings ? "Nothing called that" : "No screen called that"}
              </p>
              <p className="text-sm text-grey-500 mt-1">
                Try a shorter word, or what a guest would call it.
              </p>
            </div>
          )) : (
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label={seesBookings ? "Screens and bookings" : "Screens"}
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
                    {/* The sidebar's mark, said here too (D27-87). */}
                    {entry.item.notBuilt && (
                      <span className="text-2xs text-grey-500 shrink-0">Not built yet</span>
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
              {found.length > 0 && (
                <li role="presentation">
                  <ul role="group" aria-labelledby={`${listId}-bookings`}>
                    <li role="presentation" id={`${listId}-bookings`}
                        className="px-3 pt-3 pb-1 text-2xs font-semibold uppercase tracking-[0.025em] text-grey-500">
                      Bookings
                    </li>
                    {found.map((stay, j) => {
                      const i = results.length + j;
                      return (
                        <li
                          key={stay.id}
                          id={`${listId}-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={i === active}
                          onMouseMove={() => setActive(i)}
                          onClick={() => open_(stay)}
                          className={cn(
                            "flex items-center gap-3 px-3 min-h-14 py-1.5 rounded-md cursor-pointer",
                            "transition-colors duration-100",
                            i === active ? "bg-grey-100" : "hover:bg-grey-50",
                          )}
                        >
                          <span className="grid place-items-center size-7 rounded-md bg-grey-100 text-grey-500 shrink-0">
                            <CalendarDays className="size-4" aria-hidden />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-base text-ink-900">{stay.guest}</span>
                            <span className="block truncate text-xs text-grey-500 tabular">
                              {stay.reference} · {dateShort(stay.arrival)} – {dateShort(stay.departure)}
                              {stay.roomNumber ? ` · Room ${stay.roomNumber}` : ""}
                            </span>
                          </span>
                          <span className="text-2xs text-grey-500 shrink-0">{STAY_LABEL[stay.status] ?? stay.status}</span>
                          {i === active && (
                            <CornerDownLeft className="size-3.5 text-grey-400 shrink-0" aria-hidden />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              )}
            </ul>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
