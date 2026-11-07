import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { HeldError } from "@/lib/api";
import { Button, Dialog, DialogContent, Input, Segmented, toast } from "@/components/ui";
import {
  checklistFor, tickChecklist, JOB_LABELS, type Checklist, type ChecklistJob,
} from "@/modules/housekeeping/data/housekeeping";

/* ══════════════════════════════════════════════════════════════════
   TICKING A ROOM'S CHECKLIST (D27-383 item 10, D27-396)

   Opened by the board's Clean or Inspected when the hotel has switched
   checklists on and the room has one for the job. A cleaning job is done
   when every item is ticked, and the room is then clean. An inspection
   answers each item OK or Failed, a failed one with a note: all OK marks
   the room inspected; any failed sends it back to Needs cleaning.

   The main button is grey until the list is done, and says why when
   tapped - the board's own way (MarkButton), never a silent disabled.
   ══════════════════════════════════════════════════════════════════ */

const CLEANING: ChecklistJob[] = ["checkout", "stayover", "deep"];

export function ChecklistFlow({
  hotelId, room, kind, lists, open, onOpenChange, onDone,
}: {
  hotelId: string;
  room: { number: string; type: string; occupied: boolean };
  kind: "clean" | "inspected";
  lists: Checklist[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (state: string) => void;
}) {
  /* The jobs this room has a list for; a guest in the room is a stay-over. */
  const jobs = kind === "inspected"
    ? (["inspection"] as ChecklistJob[])
    : CLEANING.filter((j) => checklistFor(lists, room.type, j));
  const usual: ChecklistJob = room.occupied ? "stayover" : "checkout";
  const [job, setJob] = useState<ChecklistJob>(jobs.includes(usual) ? usual : jobs[0] ?? usual);
  const list = checklistFor(lists, room.type, job);
  const items = list?.items ?? [];

  /* null: not answered yet. */
  const [ok, setOk] = useState<(boolean | null)[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOk(items.map(() => null));
    setNotes(items.map(() => ""));
    setSaid(null);
  }, [open, job, list?.id]); // the list's items, read afresh when it opens or the job changes

  const inspection = job === "inspection";
  const failed = items.filter((_, i) => ok[i] === false);
  const why = inspection
    ? (items.find((_, i) => ok[i] === null) !== undefined
        ? `Answer every item first: ${items.filter((_, i) => ok[i] === null).join(", ")}.`
        : items.find((_, i) => ok[i] === false && !notes[i]?.trim())
          ? `Say what is wrong with: ${items.find((_, i) => ok[i] === false && !notes[i]?.trim())}.`
          : null)
    : (items.some((_, i) => ok[i] !== true)
        ? `Tick every item first: ${items.filter((_, i) => ok[i] !== true).join(", ")}.`
        : null);

  const save = async () => {
    if (why) return setSaid(why);
    setBusy(true);
    try {
      const res = await tickChecklist(hotelId, {
        room: room.number, job,
        results: items.map((item, i) => ({ item, ok: ok[i] === true, ...(notes[i]?.trim() ? { note: notes[i]!.trim() } : {}) })),
      });
      if (!res.ok) { setSaid(res.reason); return; }
      const state = res.data?.state ?? (inspection ? "inspected" : "clean");
      toast.success(state === "dirty"
        ? `Room ${room.number} goes back to Needs cleaning.`
        : `Room ${room.number} is ${state}.`);
      onDone(state);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof HeldError) {
        toast.warning("Saved on this phone", error.message);
        onOpenChange(false);
        return;
      }
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const label = inspection
    ? failed.length ? `Send room ${room.number} back for cleaning` : `Room ${room.number} is inspected`
    : `Room ${room.number} is clean`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Room ${room.number} · ${JOB_LABELS[job]}`}
        description={inspection
          ? "Answer each item. A failed one needs a note, and sends the room back for cleaning."
          : "Tick each item as it is done. The room is clean when every item is ticked."}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant={inspection && failed.length ? "danger" : "primary"}
              aria-disabled={why ? true : undefined}
              className={cn(why && "opacity-60")}
              disabled={busy}
              onClick={() => void save()}
              data-checklist-save
            >
              {label}
            </Button>
          </div>
        }
      >
        {jobs.length > 1 && (
          <Segmented
            className="mb-4"
            value={job}
            onChange={setJob}
            options={jobs.map((j) => ({ value: j, label: JOB_LABELS[j] }))}
          />
        )}
        <ul className="divide-y divide-grey-100 -mx-1">
          {items.map((item, i) => (
            <li key={item} className="px-1 py-1.5" data-checklist-item={item}>
              {inspection ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-base text-ink-900">{item}</span>
                    <Answer on={ok[i] === true} tone="ok" label={`${item}: OK`}
                      onPress={() => setOk((o) => o.map((v, k) => (k === i ? true : v)))} />
                    <Answer on={ok[i] === false} tone="failed" label={`${item}: failed`}
                      onPress={() => setOk((o) => o.map((v, k) => (k === i ? false : v)))} />
                  </div>
                  {ok[i] === false && (
                    <Input
                      className="mt-2"
                      aria-label={`What is wrong with ${item}`}
                      placeholder="What is wrong"
                      value={notes[i] ?? ""}
                      onChange={(e) => setNotes((n) => n.map((v, k) => (k === i ? e.target.value : v)))}
                    />
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={ok[i] === true}
                  onClick={() => setOk((o) => o.map((v, k) => (k === i ? v !== true : v)))}
                  className="press flex items-center gap-3 w-full min-h-11 text-left cursor-pointer"
                >
                  <span className={cn(
                    "grid place-items-center size-6 shrink-0 rounded-md border",
                    ok[i] === true ? "bg-success border-success text-white" : "bg-white border-grey-300",
                  )}>
                    {ok[i] === true && <Check className="size-4" aria-hidden />}
                  </span>
                  <span className="text-base text-ink-900">{item}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        <p role="status" className={cn("text-sm text-brand-red-700", said ? "mt-3" : "sr-only")} data-checklist-said>
          {said ?? ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** OK or Failed on one inspection item: 44px, a word, pressed or not. */
function Answer({ on, tone, label, onPress }: {
  on: boolean; tone: "ok" | "failed"; label: string; onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onPress}
      className={cn(
        "press inline-flex items-center gap-1 min-h-11 px-3 rounded-full border text-sm font-medium cursor-pointer",
        on && tone === "ok" && "bg-success-50 border-success text-success-600",
        on && tone === "failed" && "bg-brand-red-50 border-brand-red-100 text-brand-red-700",
        !on && "bg-white border-grey-300 text-grey-700",
      )}
    >
      {tone === "ok" ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      {tone === "ok" ? "OK" : "Failed"}
    </button>
  );
}
