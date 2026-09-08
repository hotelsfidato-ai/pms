import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useSearchParams } from "react-router";
import { Flame, ArrowLeft, Check, Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useLiveOrders } from "@/lib/useLiveOrders";
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

  /* ⚠ TWO VIEWS OF ONE BOARD, and a kitchen needs both at different
     moments. BY STAGE is what a chef on a section works from: everything
     that needs starting, everything on the fire. BY TABLE is what the
     person calling the pass works from — "table 7 has been waiting
     eleven minutes and its mains are still on the fire" is a question
     the three columns cannot answer at all, because table 7's dishes are
     scattered across all of them.

     Kept in the URL rather than in state, so a pass screen that reloads
     — and they do, all night — comes back to the view somebody chose. */
  const [params, setParams] = useSearchParams();
  const byTable = params.get("by") === "table";
  const setBy = (v: "stage" | "table") => {
    const next = new URLSearchParams(params);
    if (v === "stage") next.delete("by"); else next.set("by", "table");
    setParams(next, { replace: true });
  };

  /* THE TILL PUSHES. A waiter adds a dish and it lands here, rather
     than up to ten seconds later — and a pass screen lives in a
     background tab, where the browser throttled the old poll to about
     once a minute. */
  const { live } = useLiveOrders(hotelId);

  const board = useQuery({
    queryKey: ["kitchen", hotelId],
    queryFn: () => getKitchen(hotelId),
    /* ⚠ THE POLL STAYS, AND IT IS NOW A FLOOR RATHER THAN THE
       MECHANISM. A live channel that fails quietly is worse than no
       live channel: nobody goes looking, they just stop believing the
       screen. So if the stream drops, this still refreshes — slower,
       and the header says so out loud.

       Sixty seconds while the stream is up, six while it is not. The
       old code polled every ten AND ran a second interval doing the
       same invalidation — two mechanisms for one job, which is how
       they drift. There is one now. */
    refetchInterval: live ? 60_000 : 6_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

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
          <p className="text-2xs text-grey-500 tabular flex items-center gap-2">
            {lines.filter((l) => !l.cancelled).length} dishes working
            {/* NAMED, because the failure it describes is invisible.
                A dropped stream leaves a screen that looks exactly
                like a working one until somebody shouts about a dish
                that never appeared. Green means the till reaches this
                screen; amber means it is back on a timer. */}
            <span
              data-live={live ? "yes" : "no"}
              className={cn(
                "inline-flex items-center gap-1 uppercase tracking-wide",
                live ? "text-success" : "text-brand-tangerine",
              )}
            >
              <i className={cn(
                "size-1.5 rounded-full",
                live ? "bg-success" : "bg-brand-tangerine",
              )} />
              {live ? "live" : "reconnecting"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md bg-grey-100 shrink-0">
          {([["stage", "By stage"], ["table", "By table"]] as const).map(
            ([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setBy(v)}
                aria-pressed={byTable === (v === "table")}
                className={cn(
                  "h-10 px-3.5 rounded text-base cursor-pointer",
                  "transition-colors duration-200",
                  byTable === (v === "table")
                    ? "bg-white text-ink-900 font-medium shadow-sm"
                    : "text-grey-600 hover:text-ink-900",
                )}
              >
                {label}
              </button>
            ))}
        </div>
        <Link
          to={`/h/${hotelId}/till`}
          className="inline-flex items-center gap-2 h-12 px-4 rounded-md border border-grey-300 text-base text-grey-700"
        >
          <ArrowLeft className="size-4" />
          Console
        </Link>
      </header>

      {byTable ? (
        <ByTable lines={lines} busy={busy} onMove={move} />
      ) : (
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
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   THE PASS, BY TABLE

   One card per table, its dishes grouped by course, oldest table first.
   This is the view the person calling the pass works from: the three
   stage columns scatter one table's food across the whole screen, so
   "is table 7 ready to go" is a question nobody can answer by looking.

   ⚠ COURSES IN ORDER, AND UNSEQUENCED LAST. A drink is not course zero
   and must not sort ahead of the starters — it is simply not part of the
   sequence, and it goes when it is poured.

   ⚠ A TABLE IS AS OLD AS ITS OLDEST DISH. Sorting on the newest would
   put a table that has been waiting twenty minutes below one that just
   ordered, which is exactly backwards from what this screen is for.
   ══════════════════════════════════════════════════════════════════ */
function ByTable({ lines, busy, onMove }: {
  lines: KitchenLine[];
  busy: string | null;
  onMove: (line: KitchenLine, to: "preparing" | "ready" | "served") => void;
}) {
  const tables = new Map<string, KitchenLine[]>();
  for (const l of lines) {
    /* A takeaway has no table and each order is its own card — grouping
       every takeaway together would read as one enormous table. */
    const key = l.table ?? `${l.orderType}·${l.orderNo}`;
    const at = tables.get(key);
    if (at) at.push(l); else tables.set(key, [l]);
  }

  const oldest = (ls: KitchenLine[]) =>
    Math.max(...ls.map((l) => l.waitedSeconds));

  const groups = [...tables.entries()]
    .sort((a, b) => oldest(b[1]) - oldest(a[1]));

  if (groups.length === 0) {
    return (
      <div className="flex-1 grid place-items-center bg-grey-50">
        <p className="text-lg text-grey-400">Nothing with the kitchen.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-grey-50 p-3">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
        {groups.map(([key, ls]) => {
          const wait = oldest(ls);
          const late = wait >= 600;
          const warm = wait >= 300;

          /* Courses lowest first, unsequenced last. `null` sorts after
             every number rather than being treated as zero. */
          const courses = [...new Set(ls.map((l) => l.course ?? null))]
            .sort((a, b) => {
              if (a === null) return 1;
              if (b === null) return -1;
              return a - b;
            });

          return (
            <section
              key={key}
              className={cn(
                "rounded-lg border-2 bg-white overflow-hidden",
                late ? "border-brand-red"
                  : warm ? "border-brand-yellow" : "border-grey-200",
              )}
            >
              <header className="flex items-baseline gap-2 px-3.5 py-2.5 border-b border-grey-200">
                <h2 className="text-lg font-semibold text-ink-900 flex-1 min-w-0 truncate">
                  {ls[0]!.table ?? ls[0]!.orderType.replace(/_/g, " ")}
                </h2>
                <span className="text-2xs text-grey-500">
                  {ls[0]!.orderNo}
                </span>
                <span className={cn(
                  "tabular text-base font-semibold",
                  late ? "text-brand-red"
                    : warm ? "text-brand-yellow" : "text-grey-500",
                )}>
                  {waited(wait)}
                </span>
              </header>

              <div className="p-2.5 space-y-3">
                {courses.map((course) => {
                  const mine = ls.filter((l) => (l.course ?? null) === course);
                  return (
                    <div key={course ?? "none"}>
                      <p className="text-2xs uppercase tracking-wide text-grey-400 mb-1.5 px-1">
                        {course === null ? "Any time" : `Course ${course}`}
                      </p>
                      <div className="space-y-2">
                        {mine.map((l) => {
                          const col = COLUMNS.find((c) => c.key === l.status);
                          return (
                            <Ticket
                              key={l.id}
                              line={l}
                              action={col?.action ?? "Done"}
                              busy={busy === l.id}
                              onMove={() =>
                                onMove(l, col?.next ?? "served")}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
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
     it without reading. Ten minutes is the threshold most passes use.

     ⚠ A DISH AT THE PASS IS ON A MUCH SHORTER CLOCK. Food under a lamp
     is dying, not cooking, and two minutes there is worse than eight in
     a pan. So a ready dish is judged on how long it has been WAITING FOR
     A WAITER rather than on its total age — otherwise a fast dish
     plated in three minutes reads as calm while it goes cold. */
  /* `?? null` and `!= null` throughout — defect 201's lesson, applied
     the same afternoon it was learned. The read cache holds a response
     for a week, so a browser can be showing a kitchen feed from before
     these two fields existed; `=== null` is false for undefined and
     would print the literal string "undefined min est" on a pass
     screen. A field that is missing and a field that is unset mean the
     same thing to a chef: nobody has said. */
  const atPass = line.atPassSeconds ?? null;
  const late = atPass != null ? atPass >= 300 : line.waitedSeconds >= 600;
  const warm = atPass != null ? atPass >= 120 : line.waitedSeconds >= 300;

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
        <span className="shrink-0 text-right">
          <span className={cn(
            "block tabular text-lg font-semibold",
            late ? "text-brand-red" : warm ? "text-brand-yellow" : "text-grey-500",
          )}>
            {waited(atPass ?? line.waitedSeconds)}
          </span>
          {/* What it SHOULD take, so a chef can tell a slow dish from a
              dish that is simply slow to make. A dash when nobody has
              timed it — never a zero, which would read as instant. */}
          <span className="block text-2xs text-grey-500 tabular">
            {atPass != null
              ? "at the pass"
              : line.prepMinutes == null
                ? "— est"
                : `${line.prepMinutes} min est`}
          </span>
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
