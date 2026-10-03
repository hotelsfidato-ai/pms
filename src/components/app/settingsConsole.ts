import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Resource, Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THE SETTINGS CONSOLE'S PAGES — the registration contract (D27-249,
   D27-254, D27-256)

   A service puts a page into the console by adding a file of its OWN,
   `src/modules/<module>/<anything>.settings.ts`, exporting
   `settingsPages: SettingsPage[]`. This file finds every such file itself,
   so nobody edits a shared list to add a page. The page is at
   /settings/<group>/<slug>; the navigation reads this list, so it is in
   mayReach and "Find a screen" with no other edit.

   NOT through a module's index.ts: index.ts imports pages, pages import the
   navigation, and the navigation imports this — a cycle. `load` keeps a
   registration free of page imports, and a page loads when it is opened.

   THE PAGE: a default export drawing its own <Page> and <PageHeader> (title
   = `label`). The hotel is the top bar's, `useUi((s) => s.hotelId)`, not in
   the address. It is rendered for /settings/<group>/<slug> and everything
   below it (`useParams()["*"]`, or nested <Routes>). The server guards its
   own API as before; the console only hides.

   WHO: the console needs `setting` (owner, Admin, GM), always. `resource`
   (default "setting") and `canSee` narrow it. A `to` entry is a link to a
   Front office screen (↗), shown only where the navigation lets the person
   open that screen.

   STAND-INS are phase 1's placeholders for what exists today
   (admin/console.settings.ts). A page registered at the same group and slug
   replaces one, with no edit to admin.

   Moving an existing screen in: redirect its old address and take its old
   menu entry out IN THE SAME COMMIT (MEMORY 375).
   ══════════════════════════════════════════════════════════════════ */

export const SETTINGS_GROUPS = [
  { key: "property", label: "Property" },
  { key: "rooms", label: "Rooms" },
  { key: "rates", label: "Rates and tax" },
  { key: "money", label: "Money" },
  { key: "lists", label: "Lists" },
  { key: "front-desk", label: "Front desk" },
  { key: "messages", label: "Messages" },
  { key: "people", label: "People and security" },
  { key: "connections", label: "Modules and connections" },
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]["key"];

export type SettingsPage = {
  group: SettingsGroup;
  /** Kebab-case, unique in its group: /settings/<group>/<slug>. */
  slug: string;
  /** The menu's words; the page's PageHeader says the same. */
  label: string;
  /** Find a screen's glyph. */
  icon: LucideIcon;
  /** Its place in the group, in tens. */
  order: number;
  /** Narrows the console's own `setting`. Default "setting". */
  resource?: Resource;
  /** Narrower still, e.g. the owner and an Admin only. */
  canSee?: (role: Role) => boolean;
  /** Other words Find a screen matches. */
  keywords?: string[];
  /** Phase 1's placeholder: yields to a page registered at its address. */
  standIn?: true;
} & (
  | { load: () => Promise<{ default: ComponentType }> }
  | { to: string }
);

export const addressOf = (page: Pick<SettingsPage, "group" | "slug">): string =>
  `/settings/${page.group}/${page.slug}`;

const rank = (group: SettingsGroup) => SETTINGS_GROUPS.findIndex((g) => g.key === group);

/** The pages as the console shows them: a stand-in gone where a page took
    its address, in the groups' order and then each page's own. */
export function assemble(pages: readonly SettingsPage[]): SettingsPage[] {
  const taken = new Set(pages.filter((p) => !p.standIn).map(addressOf));
  return pages
    .filter((p) => !p.standIn || !taken.has(addressOf(p)))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.order - b.order);
}

/** What the frame test refuses: two pages at one address (a stand-in and
    the page replacing it are not two), and a slug that is not kebab-case. */
export function problems(pages: readonly SettingsPage[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const address = addressOf(page);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(page.slug)) out.push(`${address}: the slug is not kebab-case`);
    const key = `${page.standIn ? "stand-in " : ""}${address}`;
    if (seen.has(key)) out.push(`${address}: registered twice`);
    seen.add(key);
  }
  return out;
}

const FILES = import.meta.glob<SettingsPage[]>(
  "/src/modules/*/*.settings.ts", { eager: true, import: "settingsPages" });

const REGISTERED: readonly SettingsPage[] = Object.values(FILES).flat();

/** Every registration as written, stand-ins included — for the frame test. */
export const registered = (): readonly SettingsPage[] => REGISTERED;

/** The console's pages. */
export const SETTINGS_PAGES: readonly SettingsPage[] = assemble(REGISTERED);
