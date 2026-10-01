import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { makeRequest } from "@/modules/online-checkin/data/guestPage";
import { messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   ONE-TAP CHOICES (D27-224, D27-225) - inside "Ask for something"

   While the guest is checked in (the door offers the teams' kinds), the
   things most asked for are tiles: tap one, a count for the three that come
   in numbers, Send. It is the same request the text box sends - kind and
   words - so the desk, the team, the bell and the ten-open cap are as they
   are (D27-181). All free; the list is fixed here (D27-224). Food and drink
   has no tiles: it is the text box, under "Something else".
   ══════════════════════════════════════════════════════════════════ */

type Item = { kind: "housekeeping" | "maintenance"; label: string; counted?: true };

const ITEMS: Item[] = [
  { kind: "housekeeping", label: "Drinking water", counted: true },
  { kind: "housekeeping", label: "Fresh towels", counted: true },
  { kind: "housekeeping", label: "Toiletries", counted: true },
  { kind: "housekeeping", label: "Clean my room" },
  { kind: "maintenance", label: "AC" },
  { kind: "maintenance", label: "Plumbing" },
  { kind: "maintenance", label: "Power/lights" },
  { kind: "maintenance", label: "TV/Wi-Fi" },
];
const GROUPS = [
  { kind: "housekeeping", title: "Housekeeping" },
  { kind: "maintenance", title: "Something broken" },
] as const;

/** "Drinking water × 2" - the × only from 2 up (the master's Q2). */
export const whatOf = (label: string, count: number) => (count > 1 ? `${label} × ${count}` : label);

/** Whether the door offers any tile's kind - only while checked in (170). */
export const hasQuickChoices = (offers: string[]) => ITEMS.some((i) => offers.includes(i.kind));

const TILE = "press-tile min-h-11 rounded-lg px-3 py-2.5 text-left text-sm font-medium ring-1 ring-inset "
  + "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const tile = (on: boolean) =>
  cn(TILE, on ? "bg-ink-900 ring-ink-900 text-white" : "bg-white ring-grey-200 text-ink-900 hover:ring-grey-400");

export function QuickChoices(
  { token, offers, onOther, onUnlockGone }:
  { token: string; offers: string[]; onOther: (open: boolean) => void; onUnlockGone: () => void },
) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Item | "other" | null>(null);
  const [count, setCount] = useState(1);

  const send = useMutation({
    mutationFn: (item: Item) => makeRequest(token, { kind: item.kind, what: whatOf(item.label, item.counted ? count : 1) }),
    onSuccess: async () => {
      setChosen(null);
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "requests"] });
    },
  });
  useUnlockGone(send.error, onUnlockGone);

  const choose = (next: Item | "other") => {
    setChosen(next);
    setCount(1);
    onOther(next === "other");
  };
  const item = chosen !== null && chosen !== "other" ? chosen : null;

  return (
    <div className="flex flex-col gap-3 mb-3.5">
      {GROUPS.filter((g) => offers.includes(g.kind)).map((g) => (
        <div key={g.kind}>
          <p className="text-xs font-medium text-grey-600 mb-2">{g.title}</p>
          <div className="grid grid-cols-2 gap-2">
            {ITEMS.filter((i) => i.kind === g.kind).map((i) => (
              <button key={i.label} type="button" aria-pressed={chosen === i}
                      className={tile(chosen === i)} onClick={() => choose(i)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" aria-pressed={chosen === "other"}
              className={tile(chosen === "other")} onClick={() => choose("other")}>
        Something else
      </button>

      {item?.counted && (
        <div>
          <p className="text-xs font-medium text-grey-600 mb-2">How many?</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-pressed={count === n}
                      className={cn(tile(count === n), "text-center tabular-nums")}
                      onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      {item && (
        <Button type="button" variant="secondary" disabled={send.isPending}
                onClick={() => send.mutate(item)}>
          {send.isPending ? "Sending…" : "Send the request"}
        </Button>
      )}
      {send.error && !unlockGone(send.error) && (
        <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
      )}
    </div>
  );
}
