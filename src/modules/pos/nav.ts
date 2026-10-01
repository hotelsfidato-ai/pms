import {
  LayoutGrid, Receipt, MonitorSmartphone, Flame, UtensilsCrossed, Banknote, Plug, SlidersHorizontal,
  CalendarClock,
} from "lucide-react";
import { can, canAccess, type Role } from "@/lib/permissions";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Who may ring up an order: the server's own rule (roleGate.ts TILL, `payment`
   create, and the till operator). A Viewer or an Accountant who may only READ
   the restaurant's orders is not offered the till (QA RO-4). */
export const mayRingUp = (role: Role): boolean => can(role, "create", "payment") || role === "pos";

/* The restaurant's menu entries — the Point of sale section, which is
   absent at a property without the POS module and, for reception, where
   "Reception can use the POS" is off (see the section in `navigation.ts`). */
export const nav: ServiceNavEntry[] = [
  /* The FLOOR first, because that is where a shift starts: a waiter
     walks to a table before there is a bill to stand at. */
  { section: "point-of-sale", order: 10, workingMenus: ["front_desk", "pos"],
    label: "Tables", to: "/h/:code/floor", icon: LayoutGrid, resource: "payment",
    keywords: ["floor", "restaurant"],
    canSee: (role) => mayRingUp(role) },
  /* Hotel guests' requests for a table (D27-221, D27-224): answered by the
     till's people, as the server asks (roleGate TABLE_ANSWER). */
  { section: "point-of-sale", order: 15,
    label: "Table bookings", to: "/h/:code/table-bookings", icon: CalendarClock, resource: "payment",
    keywords: ["table booking", "reservation", "restaurant booking", "dinner", "lunch"],
    canSee: (role) => mayRingUp(role) },
  /* The till, the one somebody stands at. */
  { section: "point-of-sale", order: 20, workingMenus: ["front_desk", "pos"],
    label: "Till", to: "/h/:code/till", icon: Receipt, resource: "payment",
    keywords: ["pos", "order", "restaurant bill"],
    canSee: (role) => mayRingUp(role) },
  /* A dedicated screen for a fixed terminal: no sidebar, no chrome,
     one outlet, targets sized for a thumb rather than a mouse. */
  {
    section: "point-of-sale", order: 30, workingMenus: ["front_desk", "pos"],
    label: "Terminal", to: "/h/:code/till/terminal",
    icon: MonitorSmartphone, resource: "payment",
    keywords: ["pos terminal"],
    canSee: (role) => mayRingUp(role),
  },
  /* The pass. A wall screen in the kitchen, behind the same
     permission as the till — the people who cook and the people who
     ring up are the same restaurant. */
  /* ⚠ "The people who cook" never HAD that permission: chef and
     kitchen_manager hold no `payment` grant, so the pass was missing
     from the menu of the only two roles it exists for — they had to
     know the address. The server has always let them in (till.ts
     refuses only reception). Fixed 15 September, owner's yes. */
  { section: "point-of-sale", order: 40, workingMenus: ["chef", "kitchen_manager"],
    label: "Kitchen", to: "/h/:code/kitchen", icon: Flame, resource: "payment",
    keywords: ["kot", "pass", "orders"],
    canSee: (role) =>
      canAccess(role, "payment") || role === "chef" || role === "kitchen_manager" },
  /* The dishes and their prices. The menu's own grant since 22 September:
     it rode on `rate` - "setting what a dish costs is the same kind of act
     as setting what a room costs" - until the owner kept the revenue
     manager, who sets room prices only, out of it (D22-35). The kitchen
     manager holds it in the matrix now rather than by name. */
  { section: "point-of-sale", order: 50, workingMenus: ["kitchen_manager"],
    label: "Menu", to: "/h/:code/menu", icon: UtensilsCrossed, resource: "menu",
    keywords: ["dishes", "items"] },
  /* Where the shift ends. Last, because it is — and beside the
     till rather than under Finance, for the same reason the till
     is here: a cashier counting a drawer at midnight is doing
     restaurant work, not the front office's. */
  {
    section: "point-of-sale", order: 60, workingMenus: ["front_desk", "pos", "kitchen_manager"],
    label: "Close restaurant day", to: "/h/:code/till/day-end",
    icon: Banknote, resource: "payment",
    keywords: ["day end", "restaurant close"],
    canSee: (role) => mayRingUp(role) || role === "kitchen_manager",
  },
  /* What an OUTSIDE till sent and what was refused. Read-only, and
     named so nobody mistakes it for the till above. */
  { section: "point-of-sale", order: 70,
    label: "Charges to rooms", to: "/h/:code/pos", icon: Plug, resource: "invoice",
    keywords: ["bridge", "pos charges"] },
  /* Setting a hotel's restaurant up (D22-6): its name, its sections and
     tables, and what is left before the first order. The owner, an
     administrator and the GM - room setup's grant (the owner, 25 Sep) - and
     last, because it is done once and before any of the above. */
  { section: "point-of-sale", order: 80,
    label: "Restaurant setup", to: "/h/:code/till/setup", icon: SlidersHorizontal,
    resource: "room_config", keywords: ["tables", "sections", "outlet", "set up restaurant"],
    canSee: (role) => can(role, "edit", "room_config") },
];
