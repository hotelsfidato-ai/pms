import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   A MENU OF ACTIONS

   The stay panel had grown seven buttons stacked down it — check in,
   void, move room, amend, and more arriving. Every one is rare, and a
   column of rare buttons pushes the thing somebody actually came to
   read off the screen.

   WHAT STAYS OUT OF IT. The one action a clerk is here to perform.
   Check in on an arrival, check out on a departure — those are the
   reason the panel is open, and burying them in a menu to tidy up
   would be tidying at the guest's expense. Everything else groups.

   DESTRUCTIVE ITEMS ARE MARKED AND LAST. Cancel and void sit at the
   bottom behind a separator, in red, because the cost of picking one
   by accident is a booking somebody has to rebuild.

   A DISABLED ITEM KEEPS ITS REASON. Rule 6 again: a greyed row that
   does not say why is a dead end, and this is the same fault the
   check-in button had.
   ══════════════════════════════════════════════════════════════════ */

export function Menu({
  label = "More options",
  children,
  align = "end",
}: {
  label?: string;
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            /* A capsule like every button (the owner, 27 September), 44px
               under a finger: it sits on a tablet at the front desk. */
            "press inline-flex items-center justify-center gap-1.5 h-9 pointer-coarse:min-h-11 px-3.5",
            "rounded-full border border-grey-300 bg-white",
            "text-base font-medium text-ink-900 cursor-pointer",
            "hover:bg-grey-50 hover:border-grey-400",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            "focus-visible:outline-brand-orange",
            "data-[state=open]:bg-grey-50",
          )}
        >
          {label}
          <ChevronDown className="size-4 text-grey-500" />
        </button>
      </DropdownPrimitive.Trigger>

      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          sideOffset={6}
          className={cn(
            "z-50 min-w-56 rounded-lg border border-grey-200 bg-white p-1.5",
            "shadow-lg",
            /* Radix reports where it opened, so the animation comes
               from the trigger rather than from nowhere. */
            "data-[side=bottom]:origin-top data-[side=top]:origin-bottom",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95",
          )}
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export function MenuItem({
  children,
  icon: Icon,
  onSelect,
  disabled,
  reason,
  danger,
}: {
  children: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  disabled?: boolean;
  /** Why it cannot be picked. Shown under the label, because a greyed
      row with no explanation is the fault Rule 6 exists to prevent. */
  reason?: string;
  danger?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onSelect?.();
      }}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2.5 py-2 min-h-11",
        "text-base outline-none cursor-pointer select-none",
        "transition-colors duration-100",
        disabled
          ? "text-grey-500 cursor-not-allowed"
          : danger
            ? "text-brand-red data-[highlighted]:bg-red-50"
            : "text-ink-900 data-[highlighted]:bg-grey-100",
      )}
    >
      {Icon && (
        <Icon className={cn("size-4 shrink-0 mt-0.5",
                            disabled ? "text-grey-300"
                            : danger ? "text-brand-red" : "text-grey-500")} />
      )}
      <span className="min-w-0">
        <span className="block leading-snug">{children}</span>
        {disabled && reason && (
          <span className="block text-sm text-grey-500 leading-snug mt-0.5">
            {reason}
          </span>
        )}
      </span>
    </DropdownPrimitive.Item>
  );
}

export function MenuSeparator() {
  return (
    <DropdownPrimitive.Separator className="my-1.5 h-px bg-grey-200" />
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownPrimitive.Label
      className="px-2.5 pt-2 pb-1 text-2xs font-semibold uppercase
                 tracking-wide text-grey-500"
    >
      {children}
    </DropdownPrimitive.Label>
  );
}
