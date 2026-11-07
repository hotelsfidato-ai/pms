import {
  AlertTriangle, PackageX, TrendingUp, TrendingDown, Trash2, Truck, IndianRupee, ClipboardList,
  CalendarX, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconChip } from "@/components/ui";
import { TILES, type Tile } from "@/modules/stores/lib/tiles";

/* THE TILES ACROSS THE TOP (D27-238), the Calendar's FilterTiles look: a
   count over its label; the chosen one navy; one with a job to do warm while
   it has any; a tap filters the list, a second tap clears it. On a phone the
   row scrolls inside itself, snapping. */

const ICON: Record<Tile, typeof Truck> = {
  expired: CalendarX, expiring: CalendarClock, below: AlertTriangle, runOut: PackageX, received: TrendingUp, issued: TrendingDown,
  wasted: Trash2, awaiting: Truck, notValued: IndianRupee, notCounted: ClipboardList,
};

export function StoreTiles({ counts, picked, onPick }: {
  counts: Record<Tile, number>; picked: Tile | null; onPick: (t: Tile | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter the store"
      className="mb-5 grid grid-cols-5 gap-2
                 max-sm:flex max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-5
                 max-sm:-mx-5 max-sm:px-5 max-sm:py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]"
    >
      {TILES.map(({ key, label, job }) => {
        const n = counts[key];
        const on = picked === key;
        const warm = !on && job && n > 0;
        const Icon = ICON[key];
        return (
          <button
            key={key}
            type="button"
            data-store-tile={key}
            aria-pressed={on}
            onClick={() => onPick(on ? null : key)}
            className={cn(
              "press-tile row-span-2 grid grid-rows-subgrid gap-y-1 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset",
              "max-sm:shrink-0 max-sm:min-w-[132px] max-sm:snap-start max-sm:px-3.5 max-sm:py-3",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              on ? "bg-ink-900 ring-ink-900"
                : warm ? "bg-brand-yellow-50 ring-brand-yellow-100"
                  : "bg-white ring-grey-200 hover:ring-grey-400",
            )}
          >
            <span className={cn("row-start-2 text-sm leading-[18px] max-sm:whitespace-nowrap",
              on ? "text-white/72" : "text-grey-600")}>
              {label}
            </span>
            <span className="row-start-1 flex items-center gap-2">
              <IconChip size={24} tone={on ? "glass" : warm ? "yellow" : "neutral"}><Icon /></IconChip>
              <b className={cn("text-xl leading-6 font-semibold tabular tracking-[-0.02em]",
                on ? "text-white" : "text-ink-900")}>
                {n}
              </b>
            </span>
          </button>
        );
      })}
    </div>
  );
}
