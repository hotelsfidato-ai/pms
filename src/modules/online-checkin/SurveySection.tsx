import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody, Field, Textarea, fieldProps } from "@/components/ui";
import { cn } from "@/lib/cn";
import { answerSurvey, getSurvey, type SurveyAnswer } from "@/modules/online-checkin/data/guestCare";
import { H2, LEAD, SECTION, messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   THE FEEDBACK SURVEY, AFTER CHECK-OUT (D27-383 item 10)

   A section behind the code (online-checkin rule 8): its own door route
   (api/src/routes/guestSurvey.ts), this tab's unlock on every call. Shown
   only where the hotel asks (Settings, Modules, off to start), once the
   stay is checked out, and once: after the answer it says thank you and
   asks nothing more.

   ⚠ NOT REVIEW GATING: whatever the scores, the thank-you is the same and
   nothing here asks for a review (Google forbids asking only the happy ones).
   ══════════════════════════════════════════════════════════════════ */

const PARTS = [
  { key: "room", label: "The room" },
  { key: "cleanliness", label: "Cleanliness" },
  { key: "food", label: "Food" },
  { key: "staff", label: "Staff" },
] as const;

export function SurveySection({ token, hotel, onUnlockGone }: {
  token: string; hotel: string; onUnlockGone: () => void;
}) {
  const qc = useQueryClient();
  const key = ["guest-behind", token, "survey"];
  const q = useQuery({ queryKey: key, queryFn: () => getSurvey(token), retry: false });
  const [answer, setAnswer] = useState<SurveyAnswer>(
    { overall: 0, room: null, cleanliness: null, food: null, staff: null, comment: "" });
  const send = useMutation({
    mutationFn: () => answerSurvey(token, answer),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: key }); },
  });
  useUnlockGone(q.error ?? send.error, onUnlockGone);
  if (!q.data || (!q.data.offered && !q.data.answered)) return null;

  if (q.data.answered) {
    return (
      <section className={SECTION} data-guest-survey="answered">
        <h2 className={H2}>Your feedback</h2>
        <p className={LEAD}>Thank you. Your answer reached {hotel}.</p>
      </section>
    );
  }

  return (
    <section className={SECTION} data-guest-survey="open">
      <h2 className={H2}>How was your stay?</h2>
      <p className={LEAD}>A few scores out of 5, and anything you would like to tell {hotel}. Once for this stay.</p>
      <Card className="mt-3"><CardBody>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Scores label="Your stay overall" value={answer.overall || null}
            onChange={(v) => setAnswer((a) => ({ ...a, overall: v ?? 0 }))} />
          {PARTS.map((p) => (
            <Scores key={p.key} label={p.label} optional value={answer[p.key]}
              onChange={(v) => setAnswer((a) => ({ ...a, [p.key]: v }))} />
          ))}
          <Field label="Anything you would like to tell us?" hint="Optional. The hotel's managers read it.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} maxLength={1000} value={answer.comment}
                onChange={(e) => setAnswer((a) => ({ ...a, comment: e.target.value }))} />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={!answer.overall || send.isPending}>
            {send.isPending ? "Sending…" : "Send my feedback"}
          </Button>
          {send.error && !unlockGone(send.error) && (
            <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
          )}
        </form>
      </CardBody></Card>
    </section>
  );
}

/** One to five, as five buttons; an optional part can be left out, and a
    second tap on the chosen score clears it. */
function Scores({ label, value, onChange, optional }: {
  label: string; value: number | null; onChange: (v: number | null) => void; optional?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-900">
        {label}{optional && <span className="font-normal text-grey-500"> · optional</span>}
      </span>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n}
            onClick={() => onChange(optional && value === n ? null : n)}
            className={cn(
              "press size-11 rounded-full border text-base font-semibold tabular cursor-pointer",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              value === n ? "bg-brand-orange border-brand-orange text-white"
                : "bg-white border-grey-300 text-ink-900 hover:border-grey-400",
            )}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
