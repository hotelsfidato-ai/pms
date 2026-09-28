import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Compass, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useSession, useRole, useCurrentHotel, useWorkableHotels,
} from "@/lib/session";
import { devAuth, getDevSubject, type HomeScreen } from "@/lib/api";
import { DEV_IDENTITIES } from "@/lib/devIdentities";
import { HOME_SCREENS } from "@/lib/homeScreen";
import { queryPersister } from "@/lib/persist";
import { setMyPreferences } from "@/data/repositories";
import { ROLE_LABELS } from "@/lib/permissions";
import { START_HERE } from "./startHereCards";
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

export function AccountMenu() {
  const scope = useSession((s) => s.scope);
  const signOut = useSession((s) => s.signOut);
  const signInAsDev = useSession((s) => s.signInAsDev);
  const setHotelId = useSession((s) => s.setHotelId);
  const hotelId = useSession((s) => s.hotelId);
  const role = useRole();
  const current = useCurrentHotel();
  const workable = useWorkableHotels();
  const queryClient = useQueryClient();

  if (!scope) return null;

  const devSubject = devAuth ? getDevSubject() : null;

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

      <DropdownMenuContent className="w-[290px]" align="end">
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
                onSelect={() => setHotelId(h.id)}
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
                  <span className="block text-base text-ink-900 truncate">{h.name}</span>
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
              {current?.name ?? "None assigned"}
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
