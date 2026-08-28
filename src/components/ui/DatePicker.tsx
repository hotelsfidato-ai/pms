import { useState } from "react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isBefore,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { isoDate, dateShort } from "@/lib/format";
import { Popover, PopoverTrigger, PopoverContent } from "./Overlays";

/* ══════════════════════════════════════════════════════════════════
   DATE PICKER
   A month grid, no dependency beyond date-fns. Supports a single
   date or a check-in/check-out range, which is what reservations
   actually need.
   ══════════════════════════════════════════════════════════════════ */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function MonthGrid({
  month, onMonthChange, selectedStart, selectedEnd, hovered,
  onHover, onSelect, minDate,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedStart?: Date;
  selectedEnd?: Date;
  hovered?: Date;
  onHover?: (date?: Date) => void;
  onSelect: (date: Date) => void;
  minDate?: Date;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  // While picking a range, preview the span under the cursor.
  const rangeEnd = selectedEnd ?? (selectedStart && hovered && hovered > selectedStart ? hovered : undefined);

  return (
    <div className="p-3 w-[268px]">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => onMonthChange(subMonths(month, 1))}
          className="p-1 rounded-sm text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-base font-semibold text-ink-900">{format(month, "MMMM yyyy")}</p>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="p-1 rounded-sm text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="h-7 flex items-center justify-center text-2xs font-medium text-grey-400">
            {d}
          </div>
        ))}

        {days.map((day) => {
          const outside = !isSameMonth(day, month);
          const disabled = minDate ? isBefore(day, minDate) && !isSameDay(day, minDate) : false;
          const isStart = selectedStart && isSameDay(day, selectedStart);
          const isEnd = rangeEnd && isSameDay(day, rangeEnd);
          const inRange =
            selectedStart && rangeEnd && day > selectedStart && day < rangeEnd;

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(day)}
              onMouseEnter={() => onHover?.(day)}
              onMouseLeave={() => onHover?.(undefined)}
              className={cn(
                "h-8 text-sm tabular relative transition-colors duration-150",
                "hover:bg-grey-100 rounded-sm",
                outside && "text-grey-300",
                !outside && "text-ink-900",
                disabled && "text-grey-300 cursor-not-allowed hover:bg-transparent",
                inRange && "bg-brand-orange-50 rounded-none hover:bg-brand-orange-100",
                (isStart || isEnd) &&
                  "bg-brand-orange text-white font-semibold hover:bg-brand-orange-600",
                isStart && rangeEnd && "rounded-r-none",
                isEnd && selectedStart && "rounded-l-none",
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Single date ───────────────────────────────────────────────── */

export function DatePicker({
  value, onChange, placeholder = "Select a date", minDate, id, invalid, disabled, className,
}: {
  /** ISO yyyy-MM-dd */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minDate?: Date;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const [month, setMonth] = useState(selected ?? new Date());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex items-center justify-between gap-2 w-full h-9 px-3 text-base text-left",
            "bg-white border border-grey-300 rounded-md",
            "transition-colors duration-150 ease-out hover:border-grey-400",
            "focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20",
            "disabled:bg-grey-50 disabled:text-grey-400 disabled:cursor-not-allowed",
            invalid && "border-brand-red focus:border-brand-red focus:ring-brand-red/20",
            className,
          )}
        >
          <span className={cn(!selected && "text-grey-400")}>
            {selected ? dateShort(selected) : placeholder}
          </span>
          <CalendarDays className="size-4 text-grey-400 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-0" align="start">
        <MonthGrid
          month={month}
          onMonthChange={setMonth}
          selectedStart={selected}
          minDate={minDate}
          onSelect={(day) => {
            onChange(isoDate(day));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ── Date range — check-in / check-out ─────────────────────────── */

export function DateRangePicker({
  from, to, onChange, minDate, id, invalid, disabled, className,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  minDate?: Date;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Date | undefined>();
  const start = from ? parseISO(from) : undefined;
  const end = to ? parseISO(to) : undefined;
  const [month, setMonth] = useState(start ?? new Date());

  function handleSelect(day: Date) {
    // First click sets the start; second sets the end unless it's earlier.
    if (!start || (start && end)) {
      onChange({ from: isoDate(day), to: undefined });
      return;
    }
    if (day <= start) {
      onChange({ from: isoDate(day), to: undefined });
      return;
    }
    onChange({ from: isoDate(start), to: isoDate(day) });
    setOpen(false);
  }

  const label =
    start && end
      ? `${dateShort(start)} → ${dateShort(end)}`
      : start
        ? `${dateShort(start)} → …`
        : "Select dates";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex items-center justify-between gap-2 w-full h-9 px-3 text-base text-left",
            "bg-white border border-grey-300 rounded-md",
            "transition-colors duration-150 ease-out hover:border-grey-400",
            "focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20",
            "disabled:bg-grey-50 disabled:text-grey-400 disabled:cursor-not-allowed",
            invalid && "border-brand-red focus:border-brand-red focus:ring-brand-red/20",
            className,
          )}
        >
          <span className={cn(!start && "text-grey-400")}>{label}</span>
          <CalendarDays className="size-4 text-grey-400 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-0" align="start">
        <div className="flex divide-x divide-grey-200">
          <MonthGrid
            month={month}
            onMonthChange={setMonth}
            selectedStart={start}
            selectedEnd={end}
            hovered={hovered}
            onHover={setHovered}
            onSelect={handleSelect}
            minDate={minDate}
          />
          <div className="hidden sm:block">
            <MonthGrid
              month={addMonths(month, 1)}
              onMonthChange={(m) => setMonth(subMonths(m, 1))}
              selectedStart={start}
              selectedEnd={end}
              hovered={hovered}
              onHover={setHovered}
              onSelect={handleSelect}
              minDate={minDate}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
