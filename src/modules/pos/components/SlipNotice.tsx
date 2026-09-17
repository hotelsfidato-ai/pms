import { useState } from "react";
import { Printer, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN SLIP THE BROWSER WOULD NOT OPEN — POS-10

   Tables and the Terminal open the slip in a new tab once the send has
   answered. A browser allows a tap to open a tab for only a few seconds
   after the tap, so on a slow line it refuses — silently. The kitchen
   has the order (it is on the pass); the paper never appeared, and
   nothing said so.

   The owner's answers of 17 September: say so, with a button that opens
   it (a new tap, which the browser allows), and say it ON THE SCREEN —
   a line that stays until the waiter opens the slip or closes the line,
   not a pop-up that has gone before a busy waiter looks.
   ══════════════════════════════════════════════════════════════════ */

export interface BlockedSlip {
  /** The slip's address on this site. */
  url: string;
  /** Which order, the way the screen says it: "Order 5 for AC1". */
  what: string;
}

/** Opens a kitchen slip in a new tab. False when the browser refused
    the tab — `window.open` answers null then, and nothing else tells. */
export function openSlip(url: string): boolean {
  return window.open(url, "_blank") !== null;
}

export function SlipNotice({ slip, onDone, className }: {
  slip: BlockedSlip;
  /** Opened, or closed by the waiter. Either way the line goes. */
  onDone: () => void;
  className?: string;
}) {
  const [again, setAgain] = useState(false);

  return (
    <div
      role="alert"
      data-slip-notice=""
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3.5 py-2",
        "border-brand-yellow-100 bg-brand-yellow-50",
        className,
      )}
    >
      <Printer className="size-4 shrink-0 text-[#8a6300]" />
      <p className="text-sm text-[#8a6300] min-w-0 flex-1">
        {slip.what} is with the kitchen, but its slip did not open — the
        browser blocked the new tab.
        {/* Refused on a fresh tap too: the browser is blocking this site
            outright, and pressing again will not change that. */}
        {again && " It was blocked again: allow pop-ups for this site in the browser."}
      </p>
      <Button
        variant="secondary"
        size="md"
        onClick={() => { if (openSlip(slip.url)) onDone(); else setAgain(true); }}
      >
        Open the kitchen slip
      </Button>
      <button
        type="button"
        onClick={onDone}
        aria-label={`Close the notice about ${slip.what}`}
        className="size-11 grid place-items-center rounded-md text-[#8a6300] hover:bg-brand-yellow-100 cursor-pointer"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
