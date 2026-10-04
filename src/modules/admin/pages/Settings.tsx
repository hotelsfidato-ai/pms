import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, useParams } from "react-router";
import { useRole } from "@/lib/session";
import { mayReach } from "@/components/app/navigation";
import { SETTINGS_PAGES, addressOf, type SettingsPage } from "@/components/app/settingsConsole";
import { Page, Skeleton } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE SETTINGS CONSOLE (D27-249, D27-256): /settings/<group>/<slug>

   Its own space, with its own menu (the sidebar draws the console's groups
   while the address is /settings...). This opens the page at the address,
   from what the services register (settingsConsole.ts), each loaded when it
   is first opened. Anywhere else under /settings - an old tab, a bare group,
   a page this person may not see - goes to the page that answers it, or to
   their first.

   WHO: the route asks `setting` (owner, Admin, GM), and each page its own
   rule, through the menu's own answer (mayReach). The server asks again.
   ══════════════════════════════════════════════════════════════════ */

/* Settings' tabs before the console - the five of 1 October and the eight
   of 30 September - and the page their things are on now. Links out there
   (a refusal, the bell, a bookmark, the commissioning checklist) keep
   opening the right page. */
const MOVED: Record<string, string> = {
  "property": "property/profile",
  "getting-started": "property/profile",
  "rates-and-taxes": "rates/taxes",
  "rooms-and-rates": "rates/taxes",
  "taxes-and-billing": "rates/taxes",
  "operations": "front-desk/times-and-rules",
  "reservations-and-front-desk": "front-desk/times-and-rules",
  "departments": "front-desk/times-and-rules",
  "people": "people/signing-in",
  "people-and-access": "people/signing-in",
  "connections": "connections/modules",
  "modules-and-connections": "connections/modules",
};

type Loaded = SettingsPage & { load: () => Promise<{ default: ComponentType }> };
const PAGES = SETTINGS_PAGES.filter((p): p is Loaded => "load" in p);

/* One lazy component a page, made once: a new one each render would load
   the page again and throw away its state. */
const components = new Map<string, LazyExoticComponent<ComponentType>>();
function componentOf(page: Loaded) {
  const key = addressOf(page);
  let found = components.get(key);
  if (!found) components.set(key, found = lazy(page.load));
  return found;
}

export default function SettingsConsole() {
  const role = useRole();
  const [group = "", slug = ""] = (useParams()["*"] ?? "").split("/");
  const open = PAGES.filter((p) => mayReach(role, addressOf(p)));
  const page = open.find((p) => p.group === group && p.slug === slug);

  if (!page) {
    const moved = slug ? undefined : MOVED[group];
    const to = open.find((p) => `${p.group}/${p.slug}` === moved)
      ?? open.find((p) => !slug && p.group === group)
      ?? open[0];
    return to ? <Navigate to={addressOf(to)} replace /> : null;
  }

  const Component = componentOf(page);
  return (
    <Suspense fallback={<Page className="max-w-6xl"><Skeleton className="h-64 w-full" /></Page>}>
      <Component />
    </Suspense>
  );
}

/** /h/:code/settings/:tab - the bell's links name the hotel: the top bar
    takes it, and the tab goes where it went. */
export function SettingsForHotel() {
  const { tab = "" } = useParams();
  return <Navigate to={`/settings/${tab}`} replace />;
}
