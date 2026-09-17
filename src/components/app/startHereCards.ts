import {
  BookPlus, LogIn, Wallet, LogOut, Banknote, SprayCan, Sparkle, Wrench,
  LayoutGrid, Send, Receipt, Flame, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   START HERE — what each person's card says (the clarity plan, step 4)

   The owner's decisions, 15 September: a card per role — reception,
   housekeeping, the waiter, the chef; none for the general manager or
   the owner — and it goes when they tap "Got it" (089).

   Each line is a JOB in the person's words, the screen it opens, and how
   to finish it there, naming the real button. Those names are checked
   against the screens — "Check in", "Take payment", "Confirm the
   booking", "Open the drawer", the sparkle and the tick, "Send",
   "Charge to room", "Start" and "Ready" — so the card cannot promise a button
   that is not there. If a label changes, this is the other place to
   change it.
   ══════════════════════════════════════════════════════════════════ */

export interface StartTask {
  /** The job, as the person would say it. */
  job: string;
  /** Where it opens — `:code` becomes the property in view. */
  to: string;
  /** How to finish it once there. One line, the real button's name. */
  how: string;
  icon: LucideIcon;
}

export const START_HERE: Partial<Record<Role, { intro: string; tasks: StartTask[] }>> = {
  front_desk: {
    intro: "The five things you will do most. Each one opens the screen it happens on.",
    tasks: [
      { job: "Take a booking", to: "/h/:code/book", icon: BookPlus,
        how: "Fill in the guest and the nights, then Confirm the booking." },
      { job: "Check a guest in", to: "/h/:code/arrivals", icon: LogIn,
        how: "Pick the guest from today's arrivals, then Check in." },
      { job: "Take a payment", to: "/h/:code/in-house", icon: Wallet,
        how: "Open the guest, go to Bill, Settle, then Take payment." },
      { job: "Check a guest out", to: "/h/:code/in-house/due-out", icon: LogOut,
        how: "Open the guest, go to Bill - Check out opens once nothing is owed." },
      { job: "Open the cash drawer", to: "/h/:code/cashiering", icon: Banknote,
        how: "Enter the opening float, then Open the drawer. Close the shift when you hand over." },
    ],
  },
  housekeeping: {
    intro: "Your three jobs. Each one opens the screen it happens on.",
    tasks: [
      { job: "See what needs cleaning", to: "/h/:code/housekeeping", icon: SprayCan,
        how: "Rooms waiting for you are listed first, under Needs cleaning." },
      { job: "Mark a room clean", to: "/h/:code/housekeeping", icon: Sparkle,
        how: "On the room, tap the sparkle once it is clean, the tick once it is inspected." },
      { job: "Report something broken", to: "/h/:code/work-orders", icon: Wrench,
        how: "Raise one, say which room and what is wrong." },
    ],
  },
  pos: {
    intro: "Your three jobs. Each one opens the screen it happens on.",
    tasks: [
      { job: "Open a table", to: "/h/:code/floor", icon: LayoutGrid,
        how: "Tap the table - its order pad opens right there." },
      { job: "Send an order to the kitchen", to: "/h/:code/floor", icon: Send,
        how: "Add the dishes on the table's pad, then Send." },
      { job: "Settle a bill", to: "/h/:code/till", icon: Receipt,
        how: "Open the order and tap how they pay: cash, card, UPI, or Charge to room." },
    ],
  },
  chef: {
    intro: "Your one screen. Everything waiting for the kitchen is on it.",
    tasks: [
      { job: "See what is waiting", to: "/h/:code/kitchen", icon: Flame,
        how: "Start a dish when you begin it, Ready when it goes out." },
    ],
  },
};

/** The screens a role LANDS on — where their card is shown. Not every
    page: a card of first jobs on every screen would be a nag. */
export const START_HERE_ON: Partial<Record<Role, string[]>> = {
  front_desk: ["/", "/h/:code/stay", "/h/:code/calendar"],
  housekeeping: ["/h/:code/housekeeping"],
  pos: ["/h/:code/floor", "/h/:code/till"],
  chef: ["/h/:code/kitchen"],
};
