import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { Check, ChevronDown, Compass, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useSession, useRole, useCurrentHotel, useWorkableHotels, roleFor,
} from "@/lib/session";
import { useUi } from "@/lib/ui";
import { devAuth, getDevSubject, type HomeScreen } from "@/lib/api";
import { DEV_IDENTITIES } from "@/lib/devIdentities";
import { HOME_SCREENS, homePath } from "@/lib/homeScreen";
import { queryPersister } from "@/lib/persist";
import { getModules, setMyPreferences } from "@/data/repositories";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { isTestHotel, plainName } from "@/lib/testHotel";
import { START_HERE } from "./startHereCards";
import { TestTag } from "./TestHotel";
import { entryFor, flatNavigationFor, navItemFor, workingHomeFor } from "./navigation";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, Avatar,
  toast,
} from "@/components/ui";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";

/* ══════════════════════════════════════════════════════════════════
   ACCOUNT MENU

   Replaces the CP1 role switcher, which was a DEMO CONTROL — it let a
   reviewer preview the product as any role. That is gone rather than
   hidden: leaving it beside a real session is how a clerk previews
   themselves as an owner.

   Nothing here is choosable except the property, and only among the
   ones this person may actually work in. The role is read from
   Postgres and displayed; it cannot be set.

   ⚠ THE "VIEW AS" SECTION IS NOT THAT SWITCHER COMING BACK. Asked for
   on 14 September, for local testing: "a switcher between the property
   and the GM of the hotel, so I can see both views". It differs from
   the CP1 control in the two ways that matter:

     · it SIGNS IN AS another staff account that exists in the local
       database — the GM's permissions are the GM's staff_hotels row,
       the same as a real GM's; no role is overridden anywhere
     · it exists only where `devAuth` is on: the local .env sets it,
       .env.production blanks it, and the API refuses the dev header
       under NODE_ENV=production even if a build carried it
   ══════════════════════════════════════════════════════════════════ */

/* PICKING A PROPERTY OPENS THE SAME SCREEN FOR IT (D27-271, the owner,
   4 October). It changed only the business date: the address kept the old
   property, so its lists showed under the new one's date.

   The property in /h/:code/... or /pos/:code/... is swapped, the rest and
   the query kept. A record (a bill, one equipment item: an address that is
   no menu entry) belongs to its own property, so it is the list it sits
   under there, the longest menu entry above it (the owner, D27-271 Q1).
   Where the person may not open that screen there - their role at that
   property or a module it does not have: mayReach's question, asked of the
   menu built with its modules - or no list is above the record, it is that
   property's first screen, worked out as the landing after sign-in does
   (App.tsx). Null where the address names no property (/settings, the
   Dashboard): only the property changes. */
export function addressAt(
  pathname: string, search: string, code: string, role: Role,
  modules: Record<string, boolean>, homeScreen: HomeScreen | undefined,
): string | null {
  const at = /^\/(h|pos)\/[^/]+/.exec(pathname);
  if (!at) return null;
  const pattern = `/${at[1]}/:code${pathname.slice(at[0].length)}`;
  /* What this person may open there, as addresses with ":code" in them. */
  const menu = flatNavigationFor(role, ":code", modules).map((i) => i.to);
  const there = (to: string) => to.replace(":code", code);
  if (menu.includes(pattern)) return there(pattern) + search;
  if (!navItemFor(pattern)) {
    /* mayReach's own lookup (D27-275): one answer to "which list is this under". */
    const list = entryFor(pattern)?.to;
    if (list && menu.includes(list)) return there(list);
  }
  const home = homePath(homeScreen, code);
  return home !== "/" ? home : workingHomeFor(role, code) ?? "/";
}

export function AccountMenu() {
  const scope = useSession((s) => s.scope);
  const signOut = useSession((s) => s.signOut);
  const signInAsDev = useSession((s) => s.signInAsDev);
  const setHotelId = useSession((s) => s.setHotelId);
  const hotelId = useSession((s) => s.hotelId);
  /* The property every screen reads, the Settings pages included. */
  const showHotel = useUi((s) => s.setHotelId);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const role = useRole();
  const current = useCurrentHotel();
  const workable = useWorkableHotels();
  const queryClient = useQueryClient();

  if (!scope) return null;

  const devSubject = devAuth ? getDevSubject() : null;

  /* Its modules first (the sidebar's own read and key), so the address, the
     lists and the date then move together. */
  const pickHotel = async (id: string, code: string) => {
    const modules = await queryClient.fetchQuery({
      queryKey: ["modules", code], queryFn: () => getModules(code), staleTime: 5 * 60_000,
    });
    const to = addressAt(pathname, search, code, roleFor(scope, id), modules, scope.homeScreen);
    setHotelId(id);
    showHotel(code);
    if (to) navigate(to);
  };

  /* Another person's screens must not show through: the in-memory cache
     AND the offline copy of it are dropped before the new identity
     loads. A GM looking at a list the owner's session had fetched would
     be testing the owner's view with the GM's name on it. */
  const viewAs = async (uid: string, label: string) => {
    if (uid === devSubject) return;
    await queryPersister.removeClient();
    queryClient.clear();
    await signInAsDev(uid);
    const failed = useSession.getState().status !== "signed-in";
    if (failed) {
      toast.error(`Could not switch to ${label}`,
        useSession.getState().error ?? "That test account is not in this database.");
      return;
    }
    toast.success(`Viewing as ${label}`, "Local test sign-in. Every permission is that account's own.");
  };

  /* WHERE THEY START (087). The GM sets it; this is the person changing
     their own, which the owner asked for on 14 September. */
  const home: HomeScreen = scope.homeScreen ?? "dashboard";
  const startOn = async (next: HomeScreen, label: string) => {
    if (next === home) return;
    const result = await setMyPreferences({ homeScreen: next });
    if (!result.ok) return toast.error("Not changed", result.reason);
    useSession.setState({ scope: { ...scope, homeScreen: next } });
    toast.success(`You will start on ${label}`, "From your next sign-in, on any device.");
  };

  /* START HERE BACK (089). Only for a role that has a card, and only once
     it has been put away — an item that does nothing is a broken item. */
  const canBringBack = Boolean(START_HERE[role]) && scope.startHereDismissed === true;
  const bringBack = async () => {
    const result = await setMyPreferences({ startHereDismissed: false });
    if (!result.ok) return toast.error("Not brought back", result.reason);
    useSession.setState({ scope: { ...scope, startHereDismissed: false } });
    toast.success("Start here is back", "It is on your first screen.");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${scope.fullName}, ${ROLE_LABELS[role]}. Account and property`}
          className={cn(
            /* 44 on touch, 36 on the console. */
            "flex items-center gap-2 h-11 lg:h-10 pl-1.5 pr-2.5 rounded-md",
            "sm:border sm:border-grey-200 bg-white",
            "hover:border-grey-300 hover:bg-grey-50",
            "transition-colors duration-150",
          )}
        >
          <Avatar name={scope.fullName} size="sm" />
          <span className="hidden sm:flex flex-col items-start leading-none min-w-0">
            <span className="text-sm font-medium text-ink-900 truncate max-w-[130px]">
              {scope.fullName}
            </span>
            <span className="text-2xs text-grey-500 mt-0.5">{ROLE_LABELS[role]}</span>
          </span>
          <ChevronDown className="size-3.5 text-grey-400 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-[290px] max-h-[calc(100dvh-5rem)] overflow-y-auto" align="end">
        <div className="px-2.5 py-2">
          <p className="text-base font-medium text-ink-900">{scope.fullName}</p>
          <p className="text-2xs text-grey-500 mt-0.5">{scope.email}</p>
          {scope.isGroupAdmin && (
            <p className="flex items-center gap-1.5 text-2xs text-success mt-1.5">
              <ShieldCheck className="size-3" />
              Group administrator - every property
            </p>
          )}
        </div>

        <DropdownMenuSeparator />

        {workable.length > 1 ? (
          <>
            <DropdownMenuLabel>Property</DropdownMenuLabel>
            {workable.map((h) => (
              <DropdownPrimitive.Item
                key={h.id}
                onSelect={() => void pickHotel(h.id, h.code)}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer select-none outline-none",
                  "transition-colors duration-150 data-[highlighted]:bg-grey-100",
                )}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0 text-brand-orange",
                    h.id === hotelId ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  {/* TEST beside a test hotel's name (D27-296 (9)). */}
                  {isTestHotel(h) ? (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="block text-base text-ink-900 truncate">{plainName(h)}</span>
                      <TestTag />
                    </span>
                  ) : (
                    <span className="block text-base text-ink-900 truncate">{h.name}</span>
                  )}
                  <span className="block text-2xs text-grey-500">
                    {h.code} · {h.city}
                  </span>
                </span>
              </DropdownPrimitive.Item>
            ))}
          </>
        ) : (
          <div className="px-2.5 py-2">
            <p className="text-2xs text-grey-500">Property</p>
            <p className="text-base text-ink-900 mt-0.5">
              {current && isTestHotel(current)
                ? <span className="flex items-center gap-1.5">{plainName(current)}<TestTag /></span>
                : current?.name ?? "None assigned"}
            </p>
            {current && (
              <p className="text-2xs text-grey-500 mt-0.5">
                {current.code} · {current.city}
              </p>
            )}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Start on</DropdownMenuLabel>
        {HOME_SCREENS.map((s) => (
          <DropdownPrimitive.Item
            key={s.value}
            onSelect={() => void startOn(s.value, s.label)}
            data-home-screen={s.value}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer select-none outline-none",
              "transition-colors duration-150 data-[highlighted]:bg-grey-100",
            )}
          >
            <Check
              className={cn(
                "size-4 shrink-0 text-brand-orange",
                s.value === home ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="text-base text-ink-900">{s.label}</span>
          </DropdownPrimitive.Item>
        ))}

        {devAuth && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <span className="text-brand-yellow">Development only</span> · view as
            </DropdownMenuLabel>
            {DEV_IDENTITIES.map((d) => (
              <DropdownPrimitive.Item
                key={d.uid}
                onSelect={() => void viewAs(d.uid, d.label)}
                data-dev-identity={d.uid}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer select-none outline-none",
                  "transition-colors duration-150 data-[highlighted]:bg-grey-100",
                )}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0 text-brand-orange",
                    d.uid === devSubject ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-base text-ink-900">{d.label}</span>
                  <span className="block text-2xs text-grey-500">{d.detail}</span>
                </span>
              </DropdownPrimitive.Item>
            ))}
          </>
        )}

        <DropdownMenuSeparator />

        {canBringBack && (
          <DropdownMenuItem onSelect={() => void bringBack()} data-start-here-back>
            <span className="flex items-center gap-2 text-ink-900">
              <Compass className="size-4 text-grey-400" />
              Show Start here again
            </span>
          </DropdownMenuItem>
        )}

        {/* The lists in memory go AFTER the sign-out: cleared while the
            screens were still signed in, they would fetch it all again. */}
        <DropdownMenuItem onSelect={() => void signOut().then(() => queryClient.clear())}>
          <span className="flex items-center gap-2 text-ink-900">
            <LogOut className="size-4 text-grey-400" />
            Sign out
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
