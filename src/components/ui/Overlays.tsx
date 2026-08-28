import { type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   OVERLAYS — Radix primitives wearing Fidato clothes.
   Everything that floats gets a shadow; nothing else does.
   Motion comes from the .motion-* classes in styles/theme.css.
   ══════════════════════════════════════════════════════════════════ */

const OVERLAY = "fixed inset-0 z-50 bg-ink-950/25 backdrop-blur-[2px] motion-fade";

/* ── Dialog ────────────────────────────────────────────────────── */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** sm 420 · md 560 · lg 760 · xl 980 */
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const DIALOG_SIZES = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
  xl: "max-w-[980px]",
};

export function DialogContent({
  title, description, children, footer, size = "md", className,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY} />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "bg-white rounded-lg shadow-overlay border border-grey-200",
          "flex flex-col max-h-[calc(100vh-4rem)] motion-pop",
          DIALOG_SIZES[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-grey-200 shrink-0">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-md font-semibold text-ink-900">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-grey-500 mt-1">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="text-grey-400 hover:text-ink-900 hover:bg-grey-100 rounded-sm p-1 -m-1 transition-colors duration-150"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="px-5 py-4 overflow-y-auto scrollbar-quiet">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-grey-200 bg-grey-50 rounded-b-lg shrink-0">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ── Drawer — a Dialog that slides from the right ──────────────── */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export function DrawerContent({
  title, description, children, footer, width = "md", className,
}: Omit<DialogContentProps, "size"> & { width?: "md" | "lg" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY} />
      <DialogPrimitive.Content
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full bg-white border-l border-grey-200 shadow-overlay",
          "flex flex-col motion-drawer",
          width === "md" ? "max-w-[420px]" : "max-w-[620px]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-grey-200 shrink-0">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-md font-semibold text-ink-900">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-grey-500 mt-1">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="text-grey-400 hover:text-ink-900 hover:bg-grey-100 rounded-sm p-1 -m-1 transition-colors duration-150"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-quiet">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-grey-200 bg-grey-50 shrink-0">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ── Dropdown menu ─────────────────────────────────────────────── */

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

const MENU_SURFACE =
  "z-50 min-w-[180px] bg-white border border-grey-200 rounded-md shadow-popover p-1 motion-menu";

export function DropdownMenuContent({
  children, align = "end", className, sideOffset = 6,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  sideOffset?: number;
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(MENU_SURFACE, className)}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children, onSelect, disabled, danger, icon, className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-base cursor-pointer select-none outline-none",
        "transition-colors duration-150",
        "data-[highlighted]:bg-grey-100 data-[highlighted]:text-ink-900",
        "data-[disabled]:text-grey-400 data-[disabled]:cursor-not-allowed data-[disabled]:bg-transparent",
        danger
          ? "text-brand-red data-[highlighted]:bg-brand-red-50 data-[highlighted]:text-brand-red"
          : "text-grey-700",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="h-px bg-grey-200 my-1 -mx-1" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wide text-grey-400">
      {children}
    </DropdownPrimitive.Label>
  );
}

/* ── Popover ───────────────────────────────────────────────────── */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  children, align = "start", className, sideOffset = 6,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  sideOffset?: number;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 bg-white border border-grey-200 rounded-md shadow-popover motion-menu",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/* ── Tooltip ───────────────────────────────────────────────────── */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content, children, side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-[260px] px-2.5 py-1.5 rounded-sm motion-menu",
            "bg-ink-900 text-white text-xs leading-snug",
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ink-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────── */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex items-center gap-1 border-b border-grey-200 -mb-px overflow-x-auto scrollbar-quiet",
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  value, children, count,
}: {
  value: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative px-3 py-2.5 text-base font-medium whitespace-nowrap",
        "text-grey-500 hover:text-ink-900 transition-colors duration-150",
        "border-b-2 border-transparent -mb-px",
        "data-[state=active]:text-ink-900 data-[state=active]:border-brand-orange",
      )}
    >
      {children}
      {count !== undefined && (
        <span className="ml-1.5 text-2xs text-grey-400 tabular">{count}</span>
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  value, children, className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content value={value} className={cn("pt-5 outline-none", className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
