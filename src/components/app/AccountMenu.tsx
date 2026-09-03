import { Check, ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useSession, useRole, useCurrentHotel, useWorkableHotels,
} from "@/lib/session";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, Avatar,
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
   ══════════════════════════════════════════════════════════════════ */

export function AccountMenu() {
  const scope = useSession((s) => s.scope);
  const signOut = useSession((s) => s.signOut);
  const setHotelId = useSession((s) => s.setHotelId);
  const hotelId = useSession((s) => s.hotelId);
  const role = useRole();
  const current = useCurrentHotel();
  const workable = useWorkableHotels();

  if (!scope) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${scope.fullName}, ${ROLE_LABELS[role]}. Account and property`}
          className={cn(
            /* 44 on touch, 36 on the console. */
            "flex items-center gap-2.5 h-11 lg:h-9 pl-1.5 pr-2.5 rounded-md",
            "border border-grey-200 bg-white",
            "hover:border-grey-300 hover:bg-grey-50",
            "transition-colors duration-150",
          )}
        >
          <Avatar name={scope.fullName} size="sm" />
          <span className="hidden sm:flex flex-col items-start leading-none min-w-0">
            <span className="text-xs font-medium text-ink-900 truncate max-w-[130px]">
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
              Group administrator — every property
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
            <p className="text-2xs text-grey-400">Property</p>
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

        <DropdownMenuItem onSelect={() => void signOut()}>
          <span className="flex items-center gap-2 text-ink-900">
            <LogOut className="size-4 text-grey-400" />
            Sign out
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
