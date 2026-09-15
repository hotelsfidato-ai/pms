import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { Popover, PopoverTrigger, PopoverContent } from "./Overlays";

/* ══════════════════════════════════════════════════════════════════
   TERM — a trade word you can tap to have explained

   A dotted underline, and a tap (or Enter) opens one plain sentence from
   the glossary. Tap, not hover: the desk and the POS are touch screens,
   and a hover-only explanation is one half the staff can never open.

   It inherits everything from the text around it — size, weight, colour,
   capitals — so it can sit in a column header, a report band or a tile
   label without restyling them. On paper it is the plain word.

   Never inside a link: a button in an <a> is invalid, and the tap would
   follow the link. The Dashboard's linked tiles take no term for that
   reason.
   ══════════════════════════════════════════════════════════════════ */

export function Term({ name, children, className }: {
  name: TermKey;
  /** The words as they appear here; the glossary's own name if omitted. */
  children?: ReactNode;
  className?: string;
}) {
  const entry = GLOSSARY[name];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-term={name}
          className={cn(
            "inline cursor-help text-left rounded-[2px] [text-transform:inherit] [letter-spacing:inherit]",
            "underline decoration-dotted decoration-1 underline-offset-[3px] decoration-current/40",
            "hover:decoration-current transition-colors duration-150",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
            "print:no-underline",
            className,
          )}
        >
          {children ?? entry.term}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(300px,calc(100vw-2rem))] p-3.5">
        <p className="text-sm font-semibold text-ink-900 normal-case tracking-normal">{entry.term}</p>
        <p className="text-sm text-grey-600 mt-1 leading-relaxed normal-case tracking-normal">{entry.means}</p>
      </PopoverContent>
    </Popover>
  );
}
