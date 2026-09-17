import { useQuery } from "@tanstack/react-query";
import { CalendarHeart } from "lucide-react";
import { Field, fieldProps, NativeSelect } from "@/components/ui";
import { getAttachableFunctions } from "@/modules/banquet";

/* ══════════════════════════════════════════════════════════════════
   WHICH BANQUET FUNCTION THIS ORDER IS FOR — D17-21

   The owner, 17 September: restaurant food reaches a banquet function's
   bill, and staff choose the function WHEN ORDERING — on Tables, the
   Terminal and the Till. Such an order is paid on the function's bill
   only; the settle panels offer that and nothing else for it.

   THE LIST IS THE BANQUET SERVICE'S, through its front door: confirmed
   functions at this property, bill open, running today. Not filtered
   again here (its own instruction) — the till's server asks the same rule
   before it writes, so the screen cannot offer what the server refuses.

   ⚠ SHOWN ONLY WHERE IT MEANS SOMETHING. A property with no hall, or no
   function on today, gets no control at all — a waiter should not pass
   an empty "Banquet function" box at every table. An order that is
   ALREADY on a function always shows it, even if the function has since
   left the list (cancelled over dinner), so nobody is left wondering why
   the bill will not take cash.
   ══════════════════════════════════════════════════════════════════ */

export function FunctionPicker({
  hotelId, value, currentTitle, onChange, disabled, className,
}: {
  hotelId: string;
  /** The function chosen now, or null. */
  value: string | null;
  /** Its name, from the order — shown when it is no longer offered. */
  currentTitle?: string | null;
  onChange: (eventId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const list = useQuery({
    queryKey: ["banquet-attachable", hotelId],
    queryFn: () => getAttachableFunctions(hotelId),
    enabled: Boolean(hotelId),
  });

  const functions = list.data?.functions ?? [];
  const offered = list.data?.enabled === true && functions.length > 0;

  /* Nothing to choose and nothing chosen: no control. A failed list is
     quiet too unless an order is already on a function — the order can
     still be taken and paid the ordinary way, and the settle refuses with
     the server's sentence if that is wrong. */
  if (!offered && !value) return null;

  const listed = functions.some((f) => f.id === value);

  return (
    <Field
      label="Banquet function"
      className={className}
      hint={value
        ? "Paid on the function's bill — settled to the function, not at the till."
        : "Only for food that goes on a function's bill."}
    >
      {(f) => (
        <div className="relative">
          <CalendarHeart className="size-4 text-grey-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <NativeSelect
            {...fieldProps(f)}
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className="pl-9 w-full h-11 text-base"
          >
            <option value="">Not for a function</option>
            {value && !listed && (
              <option value={value}>{currentTitle ?? "The function it is on"}</option>
            )}
            {functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {fn.title} · {fn.venueName} · {fn.hostName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </Field>
  );
}
