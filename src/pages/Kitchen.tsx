import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Flame, ArrowLeft, Check, Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { toast } from "@/components/ui";
import {
  getKitchen, moveKitchenLine, type KitchenLine,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE PASS

   Until this existed, orders never reached the kitchen at all. A waiter
   rang up a biryani on the till and then walked to the pass and said
   "biryani" — which is exactly what the paper system already did, so
   the till was making nobody's job easier.

   BY DISH, NOT BY TABLE

   A table orders starters, then mains twenty minutes later. The
   starters are served while the mains are still on the fire, and the
   pass needs to know which DISHES are ready, not which tables. So the
   unit here is the line, and a table appears in two columns at once
   whenever that is the truth.

   OLDEST FIRST, ALWAYS

   Sorted by when the kitchen was told, not when it was rung up. A dish
   added to an old order goes to the back of the queue, because that is
   when the kitchen learned about it. The wait is the only number on
   this screen that matters, so it is the largest thing on each ticket.

   A WALL SCREEN

   No sidebar and no navigation, like the terminal. This is read from
   across a hot kitchen, so type is large and the colours carry the
   meaning: a dish waiting over ten minutes turns red whether or not
   anybody is reading the number.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

const COLUMNS = [
  { key: "sent", label: "Ordered", next: "preparing" as const, action: "Start" },
  { key: "preparing", label: "On the fire", next: "ready" as const, action: "Ready" },
  { key: "ready", label: "At the pass", next: "served" as const, action: "Picked up" },
];

/** Minutes and seconds, because a kitchen counts in both. */
function waited(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export default function KitchenPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["kitchen", hotelId],
    queryFn: () => getKitchen(hotelId),
  });

  /* A pass screen is never touched. Without a poll it shows the order
     from twenty minutes ago and the kitchen stops trusting it. */
  useEffect(() => {
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["kitchen"] });
    }, 10_000);
    return () => clearInterval(t);
  }, [qc]);

  /* The wait has to tick between polls, or a ticket sits reading "4m 00s"
     for ten seconds and the number stops meaning anything. */
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const move = async (
    line: KitchenLine, to: "preparing" | "ready" | "served",
  ) => {
    setBusy(line.id);
    const res = await moveKitchenLine(hotelId, line.id, to);
    setBusy(null);
    if (!res.ok) return toast.error("Not moved", res.reason ?? "Refused.");
    void qc.invalidateQueries({ queryKey: ["kitchen"] });
  };

  const lines = board.data ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-grey-100 flex flex-col">
      <header className="flex items-center gap-4 px-5 h-16 border-b border-grey-300 bg-white shrink-0">
        <Flame className="size-5 text-brand-orange shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink-900 leading-tight">
            The pass
          </p>
          <p className="text-2xs text-grey-500 tabular">
            {lines.filter((l) => !l.cancelled).length} dishes working
          </p>
        </div>
        <Link
          to={`/h/${hotelId}/till`}
          className="inline-flex items-center gap-2 h-12 px-4 rounded-md border border-grey-300 text-base text-grey-700"
        >
          <ArrowLeft className="size-4" />
          Console
        </Link>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-px bg-grey-300">
        {COLUMNS.map((col) => {
          const mine = lines.filter((l) => l.status === col.key);
          return (
            <section key={col.key} className="bg-grey-50 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-grey-200 bg-white shrink-0 flex items-baseline gap-2">
                <h2 className="text-md font-semibold text-ink-900">
                  {col.label}
                </h2>
                <span className="text-base tabular text-grey-500">
                  {mine.length}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                {mine.map((l) => (
                  <Ticket
                    key={l.id}
                    line={l}
                    action={col.action}
                    busy={busy === l.id}
                    onMove={() => void move(l, col.next)}
                  />
                ))}
                {mine.length === 0 && (
                  <p className="text-base text-grey-400 text-center pt-10">
                    Nothing here.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Ticket({ line, action, busy, onMove }: {
  line: KitchenLine; action: string; busy: boolean; onMove: () => void;
}) {
  /* Colour carries the wait, so a chef glancing across the kitchen gets
     it without reading. Ten minutes is the threshold most passes use. */
  const late = line.waitedSeconds >= 600;
  const warm = line.waitedSeconds >= 300;

  if (line.cancelled) {
    return (
      <article className="rounded-lg border-2 border-brand-red bg-red-50 p-3.5">
        <div className="flex items-center gap-2">
          <Ban className="size-5 text-brand-red shrink-0" />
          <p className="text-md font-semibold text-brand-red">CANCELLED</p>
        </div>
        <p className="text-lg text-ink-900 mt-1.5 line-through">
          {line.qty} × {line.name}
        </p>
        {/* Said loudly, because the food may already be in a pan. */}
        <p className="text-base text-grey-600 mt-1">
          {line.orderNo} · stop cooking this
        </p>
      </article>
    );
  }

  return (
    <article className={cn(
      "rounded-lg border-2 bg-white p-3.5",
      late ? "border-brand-red" : warm ? "border-brand-yellow" : "border-grey-200",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            {line.table ?? line.orderType.replace(/_/g, " ")} · {line.orderNo}
          </p>
          <p className="text-xl font-semibold text-ink-900 mt-0.5 leading-tight">
            {line.qty} × {line.name}
          </p>
          {line.note && (
            /* A modifier the kitchen must not miss. Same weight as the
               dish, because "no chilli" sent back is a whole plate. */
            <p className="text-md font-semibold text-brand-orange mt-1">
              {line.note}
            </p>
          )}
        </div>
        <span className={cn(
          "tabular text-lg font-semibold shrink-0",
          late ? "text-brand-red" : warm ? "text-brand-yellow" : "text-grey-500",
        )}>
          {waited(line.waitedSeconds)}
        </span>
      </div>

      <button
        type="button"
        onClick={onMove}
        disabled={busy}
        className={cn(
          "w-full h-14 mt-3 rounded-md text-base font-semibold",
          "inline-flex items-center justify-center gap-2",
          "bg-ink-900 text-white disabled:opacity-50",
        )}
      >
        <Check className="size-4" />
        {action}
      </button>
    </article>
  );
}
