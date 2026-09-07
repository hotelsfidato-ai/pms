import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiBase, authHeaders, currentSubject } from "@/lib/api";
import {
  drain, list, remove, subscribe, watchConnection, isOnline, NO_STORE,
  type OutboxEntry,
} from "@/lib/offline";

/* ══════════════════════════════════════════════════════════════════
   WHAT IS HELD, AND WHAT WAS REFUSED

   Housekeeping has shown a pending count since defect 49, and it was
   right to. This is the same idea moved to the shell, because the
   queue is no longer one screen's: a check-in, an order and a work
   order can all be waiting at once, and a housekeeper who walks to the
   front desk should not have to open Housekeeping to find out.

   TWO STATES, NEVER MERGED.

   HELD is fine. The connection went, the work is safe, it goes when
   the line is back. It is stated calmly because panicking a clerk
   about a normal condition is how people learn to ignore a banner.

   REFUSED is not fine and cannot be retried. The server has decided —
   the room was taken by another desk, the booking was cancelled while
   the tablet was in a lift. Somebody has to look. This is the case the
   check-in tier exists to surface, and burying it under a count would
   be the whole feature failing quietly.
   ══════════════════════════════════════════════════════════════════ */

export function OfflineBar() {
  const qc = useQueryClient();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(() => isOnline());
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /* Whether this browser will hold anything at all. Not the same as
     "the queue is empty" — one is nothing waiting, the other is
     nothing CAN wait, and a clerk needs to know which before they
     start working on a dropped line. */
  const [noStore, setNoStore] = useState(false);

  const refresh = useCallback(() => {
    /* ⚠ THIS HAD NO CATCH. Reading the queue rejects when the browser
       will not open IndexedDB — a private window, site data blocked,
       and jsdom, where the global is not defined at all. The rejection
       went unhandled on every mount: silent in a browser, and in the
       suite it surfaced inside whichever test happened to be running,
       so `src/App.test.tsx` failed on some runs and passed on others.

       Swallowing it would be worse than the crash, though: the person
       who queues a check-in on a dead line would watch it vanish. So
       it is caught AND said. */
    void list()
      .then((rows) => { setEntries(rows); setNoStore(false); })
      .catch(() => { setEntries([]); setNoStore(true); });
  }, []);

  useEffect(() => {
    refresh();
    const un1 = subscribe(refresh);
    const un2 = watchConnection(() => {
      setOnline(isOnline());
      refresh();
    });
    return () => {
      un1();
      un2();
    };
  }, [refresh]);

  const send = useCallback(async () => {
    setSending(true);
    const result = await drain(async (entry) => {
      const base = await apiBase();
      return fetch(`${base}${entry.path}`, {
        method: entry.method,
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
          /* The SAME key on every attempt. Minted once, when the person
             acted. A fresh one per retry is the same as having none, and
             `folio_postings_idem_idx` would never fire. */
          "idempotency-key": entry.idempotencyKey,
        },
        ...(entry.body === undefined ? {} : { body: entry.body }),
      });
    }, currentSubject());
    setSending(false);
    setOnline(isOnline());
    refresh();
    if (result.sent > 0) {
      /* What was held has landed, so every screen showing the old
         answer is now wrong. */
      void qc.invalidateQueries();
    }
  }, [qc, refresh]);

  /* MINE, and SOMEBODY ELSE'S. A front desk is one machine and four
     clerks, so the queue can hold work that is not this person's to
     send — it would land under the wrong name, and an append-only
     ledger does not forget. Counted apart because they need different
     sentences: one is "sending", the other is "waiting for Priya". */
  const me = currentSubject();
  const mine = entries.filter((e) => e.status === "waiting" && (!e.subject || e.subject === me));
  const theirs = entries.filter((e) => e.status === "waiting" && e.subject && e.subject !== me);
  const waitingCount = mine.length;

  /* Try as soon as the line looks up AND there is something to send.
     Keyed on the connection alone this never fired on a fresh load: entries
     arrive from IndexedDB after mount, so the effect had already run
     against an empty list and `online` never changed to re-run it. The
     held change sat there with a Send now button beside it, which is
     the manual path working and the automatic one not.

     Not a timer, and it cannot spin: a failed drain sets the connection
     false, and a successful one empties the queue. Both stop it.
     Defect 49's repair note is about exactly that loop. */
  useEffect(() => {
    if (online && waitingCount > 0 && !sending) void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, waitingCount]);

  const waiting = mine;
  const refused = entries.filter((e) => e.status === "rejected");

  /* SAID ONLY WHEN IT MATTERS. A browser that will not hold a queue is
     harmless while the line is up — every action goes straight to the
     server. It becomes the most important thing on the screen the
     moment the line drops, which is exactly when the queue would have
     caught the work. Warning about it on a good connection would train
     people to dismiss the bar that matters. */
  const cannotHold = noStore && !online;

  if (online && waiting.length === 0 && refused.length === 0
      && theirs.length === 0) return null;
  if (dismissed && online && refused.length === 0 && theirs.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 flex flex-col gap-px">
      {cannotHold && (
        <div className="flex flex-wrap items-start gap-3 border-b border-brand-red-100
                        bg-brand-red-50 px-5 py-2.5 sm:px-7">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-red" />
          <p className="min-w-0 flex-1 text-sm font-medium text-brand-red">
            {NO_STORE}
          </p>
        </div>
      )}
      {/* ── Refused: a person has to look ────────────────────────── */}
      {refused.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 border-b border-brand-red-100
                        bg-brand-red-50 px-5 py-2.5 sm:px-7">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-red" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand-red">
              {refused.length === 1
                ? "One change was refused by the server."
                : `${refused.length} changes were refused by the server.`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {refused.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{e.label}</span>
                  {/* The server's own sentence. It names the conflict,
                      and rewriting it here would throw that away. */}
                  <span className="text-grey-700">{e.error}</span>
                  <button
                    type="button"
                    onClick={() => void remove(e.id)}
                    className="text-brand-red underline underline-offset-2
                               hover:no-underline cursor-pointer"
                  >
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Somebody else's, on this machine ─────────────────────
          Not an error, and not this person's to send. Named so the
          count does not sit there unexplained: a clerk seeing "3 held"
          that never moves will decide the feature is broken. */}
      {theirs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b
                        border-grey-200 bg-grey-50 px-5 py-2 sm:px-7">
          <CloudOff className="size-4 shrink-0 text-grey-500" />
          <p className="text-sm text-grey-600">
            {theirs.length === 1
              ? "1 change was made by someone else signed in on this device."
              : `${theirs.length} changes were made by someone else signed in on this device.`}
            {" They will send when that person signs in again."}
          </p>
        </div>
      )}

      {/* ── Held: normal, and calm ───────────────────────────────── */}
      {(!online || waiting.length > 0) && (
        <div className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 sm:px-7",
          online
            ? "border-info-100 bg-info-50"
            : "border-brand-yellow-100 bg-brand-yellow-50",
        )}>
          {online
            ? <RefreshCw className={cn("size-4 shrink-0 text-info", sending && "animate-spin")} />
            : <CloudOff className="size-4 shrink-0 text-[#8a6300]" />}

          <p className={cn("text-sm", online ? "text-info" : "text-[#8a6300]")}>
            {!online && "No connection. "}
            {waiting.length === 0
              ? "Working offline. Anything you can still do will be held."
              : waiting.length === 1
                ? `1 change held: ${waiting[0]!.label}.`
                : `${waiting.length} changes held.`}
            {waiting.length > 0 && !online && " They go when the line is back."}
          </p>

          {online && waiting.length > 0 && (
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="text-sm font-medium text-info underline underline-offset-2
                         hover:no-underline cursor-pointer disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send now"}
            </button>
          )}

          {online && waiting.length === 0 && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setDismissed(true)}
              className="ml-auto cursor-pointer text-info"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
