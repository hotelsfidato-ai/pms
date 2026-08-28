import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Eye } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { adminRepo } from "@/data/repositories";
import { ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/permissions";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, Avatar,
} from "@/components/ui";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";

/* ══════════════════════════════════════════════════════════════════
   ROLE SWITCHER

   Stage 1 has no authentication (Rule 1), so this is a demo control
   that lets a reviewer see how the product changes for different roles.
   When real auth arrives it is replaced by the signed-in user's role.
   ══════════════════════════════════════════════════════════════════ */

export function RoleSwitcher() {
  const role = useUi((s) => s.role);
  const setRole = useUi((s) => s.setRole);

  /* Read once and cached — this sits in the top bar of every screen,
     so it must not be a query that refires on navigation. */
  const settings = useQuery({
    queryKey: ["settings", "role-switching"],
    queryFn: () => adminRepo.settings(),
    staleTime: 5 * 60_000,
  });

  /* The setting is presentation only. The store allows any role change
     in Stage 1; real auth will gate this properly. */
  const switchingEnabled = Boolean(settings.data?.allowRoleSwitching);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Viewing as ${ROLE_LABELS[role]}. Change role`}
          className={cn(
            "flex items-center gap-2.5 h-9 pl-1.5 pr-2.5 rounded-md",
            "border border-grey-200 bg-white",
            "hover:border-grey-300 hover:bg-grey-50",
            "transition-colors duration-150",
          )}
        >
          <Avatar name="Demo User" size="sm" />
          <span className="hidden sm:flex flex-col items-start leading-none min-w-0">
            <span className="text-xs font-medium text-ink-900 truncate max-w-[130px]">
              Demo User
            </span>
            <span className="text-2xs text-grey-500 mt-0.5">{ROLE_LABELS[role]}</span>
          </span>
          <ChevronDown className="size-3.5 text-grey-400 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-[300px]" align="end">
        {switchingEnabled && (
          <div className="flex items-start gap-2 px-2.5 py-2 mb-1 rounded-sm bg-brand-orange-50">
            <Eye className="size-3.5 text-brand-orange-700 shrink-0 mt-0.5" />
            <p className="text-xs text-brand-orange-700 leading-snug">
              Changes what you see, not what you may do. Stage 1 has no authentication.
            </p>
          </div>
        )}

        {switchingEnabled && <DropdownMenuLabel>Viewing as</DropdownMenuLabel>}

        {switchingEnabled && ASSIGNABLE_ROLES.map((r) => (
          <DropdownPrimitive.Item
            key={r}
            onSelect={() => setRole(r)}
            className={cn(
              "flex items-start gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer select-none outline-none",
              "transition-colors duration-150",
              "data-[highlighted]:bg-grey-100",
            )}
          >
            <Check
              className={cn(
                "size-4 shrink-0 mt-0.5 text-brand-orange",
                r === role ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0">
              <span className="block text-base text-ink-900">{ROLE_LABELS[r]}</span>
              <span className="block text-xs text-grey-500 leading-snug mt-0.5">
                {ROLE_DESCRIPTIONS[r]}
              </span>
            </span>
          </DropdownPrimitive.Item>
        ))}

        {switchingEnabled && <DropdownMenuSeparator />}

        <div className="px-2.5 py-1.5">
          <p className="text-2xs text-grey-400">
            Signed in as Demo User · demo@fidato.local
          </p>
          <p className="text-2xs text-grey-400 mt-0.5">Property: 5 Elements Akkalkot</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => void 0}>
          <span className="flex items-center gap-2">
            <span className="text-grey-400">Sign out (disabled in demo)</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}