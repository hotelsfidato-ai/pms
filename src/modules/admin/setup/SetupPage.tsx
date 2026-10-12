import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, dateCompact, isoDate } from "@/lib/format";
import { useRole, useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import { mayReach } from "@/components/app/navigation";
import {
  Button, Card, Input, Page, PageHeader, ReadFailed, Skeleton, StatusPill, toast,
} from "@/components/ui";
import {
  SETUP_KEY, chooseStep, useSetup,
  type SetupStepState, type StepChoice, type StepState,
} from "@/modules/admin/data/setup";
import {
  GROUPS, STEPS, TOTAL_STEPS, screenAddress, stepInfo,
  type SetupStepInfo, type StepId,
} from "./steps";

/* ══════════════════════════════════════════════════════════════════
   SET UP THIS HOTEL (the owner's D27-311, 13 October)

   The 18 steps from a bare hotel to a hotel that can take a booking, in
   the owner's order and three groups. Each step says what it is and why it
   matters, opens the REAL screen (with ?setup=<step>, so the top bar can
   offer "Back to setup"), and offers the four choices: Completed, Next,
   Later, Remind me.

   NOTHING HERE DECIDES WHETHER A STEP IS DONE. The server derives it from
   what the PMS can see (`automatic`), so "Completed" is drawn only where
   nothing can be checked. Nothing is switched on or locked by this page:
   step 18 is a summary and has no button that changes anything.

   The open step is the address's ?step=, so the bell's reminder and "Back
   to setup" land on it, and Next is a move, not a request.
   ══════════════════════════════════════════════════════════════════ */

const STATE_WORDS: Record<StepState, string> = {
  done: "Done", todo: "To do", later: "Later", remind: "Remind me",
};

const stateText = (s: Pick<SetupStepState, "state" | "remindOn">): string =>
  s.state === "remind" && s.remindOn ? `Remind me ${dateCompact(s.remindOn)}` : STATE_WORDS[s.state];

const TONES: Record<StepState, "success" | "neutral" | "warning" | "accent"> = {
  done: "success", todo: "neutral", later: "warning", remind: "accent",
};

/* A step the server did not name is shown as not done, never as done. */
const UNKNOWN: Omit<SetupStepState, "id"> = {
  state: "todo", automatic: false, detail: null, remindOn: null, by: null, at: null,
};

export default function SetupPage() {
  const code = useUi((s) => s.hotelId);
  const { property } = useDocumentIdentity();
  const q = useSetup(code);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<StepId | null>(null);
  const focusAfter = useRef(false);

  const view = q.data;
  const row = (id: StepId): SetupStepState =>
    view?.steps.find((s) => s.id === id) ?? { id, ...UNKNOWN };

  /* The first step still to do, else the summary. Written into the address
     once, so a choice made on the way does not move the page under the finger. */
  const asked = stepInfo(params.get("step"))?.id;
  const first = STEPS.find((s) => s.id !== "go-live" && row(s.id).state === "todo")?.id ?? "go-live";
  const open: StepId | undefined = asked ?? (view ? first : undefined);
  useEffect(() => {
    if (!asked && view) setParams({ step: first }, { replace: true });
  }, [asked, view, first, setParams]);

  useEffect(() => {
    if (!open) return;
    const header = document.getElementById(`setup-step-${open}`);
    header?.scrollIntoView?.({ block: "nearest" });
    if (focusAfter.current) { focusAfter.current = false; header?.focus(); }
  }, [open]);

  const goTo = (id: StepId, moved = false) => {
    focusAfter.current = moved;
    setParams({ step: id }, { replace: true });
  };

  /** True when the server took it. A refusal is shown as the server wrote it. */
  const choose = async (id: StepId, choice: StepChoice): Promise<boolean> => {
    setBusy(id);
    try {
      const res = await chooseStep(code, id, choice);
      if (!res.ok) { toast.error("Not saved", res.reason); return false; }
      await qc.invalidateQueries({ queryKey: SETUP_KEY(code) });
      return true;
    } catch {
      toast.error("Not saved", "The server could not be reached. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const doneCount = (group: string) =>
    STEPS.filter((s) => s.group === group && row(s.id).state === "done").length;

  return (
    <Page className="max-w-5xl">
      <PageHeader title="Set up this hotel"
        description={`${property ? `${property}. ` : ""}${TOTAL_STEPS} steps from a new hotel to its first booking. A step ticks itself when the system can see it is done.`} />

      {q.isError ? (
        <ReadFailed error={q.error} what="the setup steps" onRetry={() => void q.refetch()} />
      ) : !view ? (
        <div className="space-y-3"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => {
            const steps = STEPS.filter((s) => s.group === group.key);
            return (
              <section key={group.key} aria-labelledby={`setup-group-${group.key}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-3">
                  <h2 id={`setup-group-${group.key}`} className="text-md font-semibold text-ink-900">{group.title}</h2>
                  {group.key !== "summary" && (
                    <span className="text-sm text-grey-500 tabular">{doneCount(group.key)} of {steps.length} done</span>
                  )}
                </div>
                {group.note && <p className="text-sm text-grey-600 -mt-2 mb-3 max-w-prose">{group.note}</p>}
                <Card className="divide-y divide-grey-100 overflow-hidden">
                  {steps.map((step) => (
                    <StepRow key={step.id} step={step} state={row(step.id)} code={code}
                      open={open === step.id} busy={busy === step.id} locked={busy !== null}
                      ready={view.ready} all={view.steps}
                      onOpen={() => goTo(step.id)} onChoose={(c) => choose(step.id, c)}
                      onNext={() => { const next = STEPS[step.number]; if (next) goTo(next.id, true); }} />
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function StepRow({ step, state, code, open, busy, locked, ready, all, onOpen, onChoose, onNext }: {
  step: SetupStepInfo; state: SetupStepState; code: string;
  open: boolean; busy: boolean; locked: boolean; ready: boolean; all: SetupStepState[];
  onOpen: () => void; onChoose: (c: StepChoice) => Promise<boolean>; onNext: () => void;
}) {
  const summary = step.id === "go-live";
  const shown: SetupStepState = summary
    ? { ...state, state: ready ? "done" : "todo" } : state;
  const done = shown.state === "done";
  const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange";

  return (
    <div data-step={step.id} data-state={shown.state}>
      <button id={`setup-step-${step.id}`} type="button" aria-expanded={open}
        aria-controls={`setup-panel-${step.id}`} onClick={onOpen}
        className={cn("w-full min-h-14 grid items-center gap-x-3 gap-y-1 px-4 py-3 text-left cursor-pointer",
          "grid-cols-[1.75rem_minmax(0,1fr)_1rem] sm:grid-cols-[1.75rem_minmax(0,1fr)_auto_1rem]",
          "hover:bg-grey-50 transition-colors duration-150", open && "bg-grey-50", focus)}>
        <span aria-hidden className={cn("col-start-1 row-start-1 grid place-items-center size-7 rounded-full",
          "text-sm font-semibold tabular",
          done ? "bg-success-50 text-success-600"
            : open ? "bg-brand-orange-50 text-brand-orange-700" : "bg-grey-100 text-grey-600")}>
          {done ? <Check className="size-4" /> : step.number}
        </span>
        <span className="col-start-2 row-start-1 min-w-0">
          <span className="sr-only">Step {step.number}: </span>
          <span className="block text-md font-semibold text-ink-900">{step.title}</span>
          {!open && <span className="block text-sm text-grey-500 truncate">{step.what}</span>}
        </span>
        <StatusPill tone={summary ? (done ? "success" : "neutral") : TONES[shown.state]} dot={false}
          className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 justify-self-start sm:justify-self-end">
          {summary ? (ready ? "Ready" : "Not ready yet") : stateText(shown)}
        </StatusPill>
        <ChevronDown aria-hidden className={cn(
          "size-4 text-grey-500 col-start-3 row-start-1 sm:col-start-4 transition-transform duration-150",
          open && "rotate-180")} />
      </button>

      <div id={`setup-panel-${step.id}`} hidden={!open}>
        {open && (
          <div className="grid gap-4 px-4 pb-4 pt-1 sm:pl-14 lg:grid-cols-2 lg:gap-8">
            <dl className="flex flex-col gap-3 min-w-0">
              <Fact label="What it is">{step.what}</Fact>
              <Fact label="Why it matters">{step.why}</Fact>
              {!summary && !done && shown.detail && <Fact label="What is missing">{shown.detail}</Fact>}
              {done && !shown.automatic && shown.by && (
                <Fact label="Marked done by">{shown.by}{shown.at ? `, ${dateCompact(shown.at)}` : ""}</Fact>
              )}
            </dl>
            {summary ? (
              <Summary ready={ready} all={all} />
            ) : (
              <div className="flex flex-col gap-3 min-w-0">
                <Screens step={step} code={code} />
                <Choices step={step} state={shown} busy={busy} locked={locked}
                  onChoose={onChoose} onNext={onNext} code={code} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium text-grey-500">{label}</dt>
      <dd className="text-base text-ink-900 leading-relaxed">{children}</dd>
    </div>
  );
}

/* THE REAL SCREENS, each opened with ?setup=<step>. One this person's role
   cannot open is shown disabled and says so, never hidden. */
function Screens({ step, code }: { step: SetupStepInfo; code: string }) {
  const role = useRole();
  const blocked = step.screens.filter((s) => !mayReach(role, s.to.replace(":code", code)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {step.screens.map((screen, i) => blocked.includes(screen) ? (
          <Button key={screen.to} size="sm" variant="secondary" disabled>Open {screen.label}</Button>
        ) : (
          <Button key={screen.to} asChild size="sm" variant={i === 0 ? "primary" : "secondary"}>
            <Link to={screenAddress(screen, code, step.id)}>Open {screen.label}</Link>
          </Button>
        ))}
      </div>
      {blocked.length > 0 && (
        <p className="text-sm text-grey-600">
          Your role cannot open {blocked.map((b) => b.label).join(", ")}. Ask the owner or an Admin.
        </p>
      )}
    </div>
  );
}

function Choices({ step, state, busy, locked, code, onChoose, onNext }: {
  step: SetupStepInfo; state: SetupStepState; busy: boolean; locked: boolean; code: string;
  onChoose: (c: StepChoice) => Promise<boolean>; onNext: () => void;
}) {
  const [reminding, setReminding] = useState(false);
  const done = state.state === "done";
  /* The hotel's own today, from the server; this device's clock only if it
     has not said. */
  const today = useSession((s) => s.hotels.find((h) => h.code === code)?.today) || isoDate(new Date());
  /* Parked by choice (or ticked by hand) - the person can take it back. */
  const undo = state.state === "later" || state.state === "remind" || (done && !state.automatic);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Choices for ${step.title}`}>
        {!state.automatic && !done && (
          <Button size="sm" loading={busy} disabled={locked} onClick={() => void onChoose({ choice: "completed" })}>
            Completed
          </Button>
        )}
        <Button size="sm" onClick={onNext}>Next</Button>
        {!done && (
          <>
            <Button size="sm" disabled={locked || state.state === "later"}
              onClick={() => void onChoose({ choice: "later" })}>Later</Button>
            <Button size="sm" disabled={locked} aria-expanded={reminding}
              onClick={() => setReminding((r) => !r)}>Remind me</Button>
          </>
        )}
        {undo && (
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => void onChoose({ choice: "clear" })}>
            Undo
          </Button>
        )}
      </div>
      {reminding && !done && (
        <RemindMe today={today} disabled={locked}
          onPick={async (remindOn) => { if (await onChoose({ choice: "remind", remindOn })) setReminding(false); }} />
      )}
    </div>
  );
}

const REMIND_IN: ReadonlyArray<[string, number]> = [["Tomorrow", 1], ["In 3 days", 3], ["In a week", 7]];

function RemindMe({ today, disabled, onPick }: {
  today: string; disabled: boolean; onPick: (remindOn: string) => void;
}) {
  const [date, setDate] = useState("");
  const earliest = addDays(today, 1);
  const tooSoon = date !== "" && date < earliest;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-grey-50 p-3" role="group" aria-label="When to remind you">
      <div className="flex flex-wrap items-center gap-2">
        {REMIND_IN.map(([label, days]) => (
          <Button key={label} size="sm" disabled={disabled} onClick={() => onPick(addDays(today, days))}>{label}</Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="Remind me on this date" min={earliest} value={date}
          onChange={(e) => setDate(e.currentTarget.value)} className="w-auto" invalid={tooSoon} />
        <Button size="sm" disabled={disabled || !date || tooSoon} onClick={() => onPick(date)}>
          Remind me on this date
        </Button>
      </div>
      {tooSoon && <p className="text-sm text-grey-600">Pick a day after today.</p>}
    </div>
  );
}

/* STEP 18: everything done, everything waiting, and whether the five things
   a first booking needs are done. Links only; nothing here changes anything. */
function Summary({ ready, all }: { ready: boolean; all: SetupStepState[] }) {
  const [, setParams] = useSearchParams();
  const byId = new Map(all.map((s) => [s.id, s]));
  const work = STEPS.filter((s) => s.id !== "go-live");
  const done = work.filter((s) => byId.get(s.id)?.state === "done");
  const left = work.filter((s) => byId.get(s.id)?.state !== "done");
  const missing = work.filter((s) => s.group === "must" && byId.get(s.id)?.state !== "done");
  /* Waiting on the person's own word first (Later, Remind me), then the rest. */
  const parked = new Set(all.filter((s) => s.state === "later" || s.state === "remind").map((s) => s.id));
  left.sort((a, b) => Number(parked.has(b.id)) - Number(parked.has(a.id)) || a.number - b.number);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {ready ? (
        <p data-ready className="flex items-start gap-2 rounded-lg bg-success-50 p-3 text-base text-ink-900">
          <CheckCircle2 aria-hidden className="size-4 text-success-600 shrink-0 mt-1" />
          <span><b className="font-semibold">Ready to go live.</b> The five things a first booking needs are done.
            Nothing is locked: change anything, at any time.</span>
        </p>
      ) : (
        <p data-not-ready className="rounded-lg bg-brand-yellow-50 p-3 text-base text-ink-900">
          <b className="font-semibold">Not ready yet.</b> Still needed before the first booking:{" "}
          {missing.map((s) => s.title).join(", ")}.
        </p>
      )}

      <div>
        <h3 className="text-base font-semibold text-ink-900 mb-1">Still to do ({left.length})</h3>
        {left.length === 0 ? (
          <p className="text-sm text-grey-600">Every step is done.</p>
        ) : (
          <ul className="divide-y divide-grey-100">
            {left.map((s) => {
              const st = byId.get(s.id) ?? { ...UNKNOWN, id: s.id };
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setParams({ step: s.id }, { replace: true })}
                    className="w-full min-h-11 flex items-center gap-3 py-2 text-left cursor-pointer hover:text-brand-orange-700">
                    <Circle aria-hidden className="size-4 text-grey-400 shrink-0" />
                    <span className="min-w-0 flex-1 text-base">Step {s.number}, {s.title}</span>
                    <span className="text-sm text-grey-500 shrink-0">{stateText(st)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-ink-900 mb-1">Done ({done.length})</h3>
        {done.length === 0 ? (
          <p className="text-sm text-grey-600">Nothing is done yet.</p>
        ) : (
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1 text-sm text-grey-600">
                <Check aria-hidden className="size-4 text-success-600 shrink-0" />{s.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
