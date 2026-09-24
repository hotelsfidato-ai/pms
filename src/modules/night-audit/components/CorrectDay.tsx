import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dateLong, dateTime, moneyPrecise as money } from "@/lib/format";
import {
  Button, Checkbox, Drawer, DrawerContent, ErrorState, Field, fieldProps, Input,
  Skeleton, Textarea, toast,
} from "@/components/ui";
import {
  getClosedDay, correctClosedDay, type DayCharge,
} from "@/modules/night-audit/data/nightAudit";

/* ══════════════════════════════════════════════════════════════════
   CORRECTING A CLOSED DAY (D22-18; the owner's D24-1 to D24-8)

   A room charge or a no-show charge that landed on a closed day wrong:
   choose it, give the right figure or take it off, and say why. Nothing is
   edited - the wrong line stays on the bill and the reversal and the right
   charge sit beside it on the same day, so that day's reports show the
   corrected figure. The owner, an administrator and the GM correct; anybody
   who reads Closed days sees the corrections made.
   ══════════════════════════════════════════════════════════════════ */

export function CorrectDay({ hotelId, day, canCorrect, onClose }: {
  hotelId: string;
  day: string;
  /** `approve` on a booking: the owner, an administrator, the GM (D24-3). */
  canCorrect: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["night-audit-day", hotelId, day],
    queryFn: () => getClosedDay(hotelId, day),
  });

  const [chosen, setChosen] = useState<DayCharge | null>(null);
  const [figure, setFigure] = useState("");
  const [takeOff, setTakeOff] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  /* No figure typed is not a figure: Save waits. 0 is only ever "Take it off".
     Money to the paisa, as on the bill. */
  const newAmount = takeOff ? 0 : figure.trim() === "" ? null : Number(figure);
  const ready = chosen !== null && newAmount !== null && Number.isFinite(newAmount)
    && newAmount >= 0 && reason.trim() !== "";

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const result = await correctClosedDay(hotelId, day,
      { postingId: chosen.id, newAmount, reason: reason.trim() });
    setBusy(false);
    /* The server's sentence: it knows about an invoice issued a moment ago,
       or a correction made on another screen. */
    if (!result.ok) return toast.error("Not corrected", result.reason);

    toast.success("Correction saved",
      `${chosen.description}: ${money(chosen.amount)} → ${newAmount === 0 ? "taken off" : money(newAmount)}.`);
    setChosen(null); setFigure(""); setTakeOff(false); setReason("");
    void queryClient.invalidateQueries();
  };

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent
        width="lg"
        title={canCorrect ? `Correct ${dateLong(day)}` : `Corrections on ${dateLong(day)}`}
        description="A closed day is corrected, never rewritten: the wrong charge stays on the bill, and the reversal and the right charge sit beside it on the same day."
        footer={canCorrect ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>
              Save correction
            </Button>
          </>
        ) : undefined}
      >
        {error ? (
          <ErrorState title="The day did not load" error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-6">
            {canCorrect && (
              <fieldset>
                <legend className="text-sm font-medium text-ink-900 mb-2">Charge to correct</legend>
                {data.charges.length === 0 ? (
                  <p className="text-sm text-grey-600">
                    No room charge or no-show charge on this day is left to correct.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {data.charges.map((c) => (
                      <label key={c.id}
                        className="flex gap-3 items-start p-3 min-h-11 rounded-md border border-grey-300 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-grey-50"
                      >
                        <input
                          type="radio" name="charge" value={c.id}
                          checked={chosen?.id === c.id}
                          disabled={c.invoice !== null}
                          onChange={() => setChosen(c)}
                          className="mt-1 size-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-base text-ink-900">{c.description}</span>
                          <span className="block text-sm text-grey-600">
                            {c.kind === "room" ? "Room charge" : "No-show charge"} · {c.guest ?? "-"}
                          </span>
                          {c.invoice && (
                            <span className="block text-sm text-brand-yellow-800 mt-1">
                              This bill has tax invoice {c.invoice}. Issue a credit note instead.
                            </span>
                          )}
                        </span>
                        <span className="text-base tabular text-ink-900 shrink-0 text-right">
                          {money(c.amount)}
                          <span className="block text-sm text-grey-600">+ {money(c.tax)} tax</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {canCorrect && chosen && (
              <div className="space-y-4">
                <Field label="The right figure, before tax" required
                  hint="The tax is worked out again, as the night audit does.">
                  {(f) => (
                    <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0} step="0.01"
                      value={takeOff ? "" : figure} disabled={takeOff}
                      onChange={(e) => setFigure(e.target.value)} placeholder={String(chosen.amount)} />
                  )}
                </Field>
                <Checkbox checked={takeOff} onCheckedChange={setTakeOff}
                  label="Take the charge off entirely" />
                <Field label="Why it was wrong" required
                  hint="Kept with the correction, with your name and the time.">
                  {(f) => (
                    <Textarea {...fieldProps(f)} rows={3} value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Corporate rate agreed at booking, charged at rack." />
                  )}
                </Field>
              </div>
            )}

            <section>
              <h3 className="text-sm font-medium text-ink-900 mb-2">Corrections on this day</h3>
              {data.corrections.length === 0 ? (
                <p className="text-sm text-grey-600">None.</p>
              ) : (
                <ul className="divide-y divide-grey-200 border-y border-grey-200">
                  {data.corrections.map((c) => (
                    <li key={c.id} className="py-3">
                      <p className="flex justify-between gap-3 text-base text-ink-900">
                        <span className="min-w-0">{c.description}</span>
                        <span className="tabular shrink-0">
                          {money(c.oldAmount)} → {c.newAmount === 0 ? "taken off" : money(c.newAmount)}
                        </span>
                      </p>
                      <p className="text-sm text-grey-600 mt-0.5">{c.reason}</p>
                      <p className="text-sm text-grey-500 mt-0.5 tabular">
                        {c.by ?? "-"} · {dateTime(c.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
